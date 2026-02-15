import { db } from "@glare/db";
import { worker } from "@glare/db/schema/workers";
import { type } from "arktype";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { logInfo, logWarn } from "../../shared/logger";

const workerIdType = type("string.uuid");
const createWorkerType = type({ name: "string" });
const updateWorkerType = type({ name: "string" });
const rotateTokenParamsType = type({ id: "string.uuid" });
const workerParamsType = type({ id: "string.uuid" });
const syncWorkerStatsType = type({
  status: '"online" | "degraded"',
  "endpoint?": "string.url <= 2048",
  uptimeMs: "number.integer >= 0",
  requestsTotal: "number.integer >= 0",
  errorTotal: "number.integer >= 0",
});

const createWorkerSchema = {
  safeParse(input: unknown) {
    if (!createWorkerType.allows(input)) {
      return { success: false as const };
    }
    const data = input as typeof createWorkerType.infer;
    const name = data.name.trim();
    if (name.length < 1 || name.length > 120) {
      return { success: false as const };
    }
    return { success: true as const, data: { name } };
  },
};
const updateWorkerSchema = {
  safeParse(input: unknown) {
    if (!updateWorkerType.allows(input)) {
      return { success: false as const };
    }
    const data = input as typeof updateWorkerType.infer;
    const name = data.name.trim();
    if (name.length < 1 || name.length > 120) {
      return { success: false as const };
    }
    return { success: true as const, data: { name } };
  },
};
const workerIdSchema = {
  safeParse(input: unknown) {
    if (!workerIdType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as string };
  },
};
const rotateTokenParamsSchema = {
  safeParse(input: unknown) {
    if (!rotateTokenParamsType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as typeof rotateTokenParamsType.infer };
  },
};
const workerParamsSchema = {
  safeParse(input: unknown) {
    if (!workerParamsType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as typeof workerParamsType.infer };
  },
};
const syncWorkerStatsSchema = {
  safeParse(input: unknown) {
    if (!syncWorkerStatsType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as typeof syncWorkerStatsType.infer };
  },
};

const WORKER_ONLINE_THRESHOLD_MS = 45_000;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function uuidToBytes(uuid: string) {
  const normalized = uuid.replace(/-/g, "");
  if (normalized.length !== 32) {
    throw new Error("Invalid UUID");
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function bytesToUuid(bytes: Uint8Array) {
  if (bytes.length !== 16) {
    throw new Error("Invalid UUID byte length");
  }

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeBase32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(input: string) {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  const normalized = input.toUpperCase();

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      return null;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Uint8Array.from(output);
}

function generateSyncToken(workerId: string) {
  const workerIdPrefix = encodeBase32(uuidToBytes(workerId));
  const randomSuffix = randomBytes(32).toString("base64url");
  return `${workerIdPrefix}:${randomSuffix}`;
}

function hashSyncToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

function parseWorkerIdFromSyncToken(token: string) {
  const tokenParts = token.split(":");
  if (tokenParts.length !== 2) {
    return null;
  }

  const encodedWorkerId = tokenParts[0];
  if (!encodedWorkerId) {
    return null;
  }

  const decoded = decodeBase32(encodedWorkerId);
  if (!decoded || decoded.length !== 16) {
    return null;
  }

  const workerId = bytesToUuid(decoded);
  return workerIdSchema.safeParse(workerId).success ? workerId : null;
}

function verifySyncToken(token: string, expectedTokenHash: string | null) {
  if (!expectedTokenHash) {
    return false;
  }

  const providedHash = hashSyncToken(token);

  try {
    return timingSafeEqual(Buffer.from(providedHash, "hex"), Buffer.from(expectedTokenHash, "hex"));
  } catch {
    return false;
  }
}

function mapWorkerResponse(record: {
  id: string;
  name: string;
  status: string;
  lastSeenAt: Date | null;
  uptimeMs: number;
  requestsTotal: number;
  errorTotal: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    lastSeenAt: record.lastSeenAt,
    uptimeMs: record.uptimeMs,
    requestsTotal: record.requestsTotal,
    errorTotal: record.errorTotal,
    isOnline:
      record.lastSeenAt !== null &&
      Date.now() - new Date(record.lastSeenAt).getTime() <= WORKER_ONLINE_THRESHOLD_MS,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export const workerRoutes = new Elysia()
  .get("/api/workers", async ({ request, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const workers = await db.query.worker.findMany({
      where: (table, { eq }) => eq(table.userId, user.id),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      columns: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        uptimeMs: true,
        requestsTotal: true,
        errorTotal: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { workers: workers.map(mapWorkerResponse) };
  })
  .post("/api/workers", async ({ request, body, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsed = createWorkerSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { error: "Invalid worker payload" });
    }

    const workerId = crypto.randomUUID();
    const syncToken = generateSyncToken(workerId);
    const syncTokenHash = hashSyncToken(syncToken);

    const [createdWorker] = await db
      .insert(worker)
      .values({
        id: workerId,
        userId: user.id,
        name: parsed.data.name,
        syncTokenHash,
        syncToken,
      })
      .returning({
        id: worker.id,
        name: worker.name,
        status: worker.status,
        lastSeenAt: worker.lastSeenAt,
        uptimeMs: worker.uptimeMs,
        requestsTotal: worker.requestsTotal,
        errorTotal: worker.errorTotal,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt,
      });

    if (!createdWorker) {
      return status(500, { error: "Failed to create worker" });
    }

    logInfo("worker created", {
      workerId: createdWorker.id,
      userId: user.id,
      name: createdWorker.name,
    });
    return status(201, { worker: mapWorkerResponse(createdWorker), syncToken });
  })
  .patch("/api/workers/:id", async ({ request, params, body, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedParams = workerParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return status(400, { error: "Invalid worker id" });
    }

    const parsedBody = updateWorkerSchema.safeParse(body);
    if (!parsedBody.success) {
      return status(400, { error: "Invalid worker payload" });
    }

    const existingWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, parsedParams.data.id), eq(table.userId, user.id)),
      columns: {
        id: true,
      },
    });

    if (!existingWorker) {
      return status(404, { error: "Worker not found" });
    }

    await db.$client.query(
      `UPDATE "worker" SET "name" = $1, "updated_at" = NOW() WHERE "id" = $2`,
      [parsedBody.data.name, existingWorker.id],
    );

    const updatedWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, existingWorker.id), eq(table.userId, user.id)),
      columns: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        uptimeMs: true,
        requestsTotal: true,
        errorTotal: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!updatedWorker) {
      return status(500, { error: "Failed to update worker" });
    }

    return { worker: mapWorkerResponse(updatedWorker) };
  })
  .delete("/api/workers/:id", async ({ request, params, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedParams = workerParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return status(400, { error: "Invalid worker id" });
    }

    const existingWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, parsedParams.data.id), eq(table.userId, user.id)),
      columns: {
        id: true,
      },
    });

    if (!existingWorker) {
      return status(404, { error: "Worker not found" });
    }

    await db.$client.query(`DELETE FROM "worker" WHERE "id" = $1`, [existingWorker.id]);

    return status(204);
  })
  .get("/api/workers/:id/sync-events", async ({ request, params, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedParams = workerParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return status(400, { error: "Invalid worker id" });
    }

    const hoursParam = Number(query?.hours) || 24;
    const hours = Math.max(1, Math.min(168, hoursParam));

    const existingWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, parsedParams.data.id), eq(table.userId, user.id)),
      columns: { id: true },
    });

    if (!existingWorker) {
      return status(404, { error: "Worker not found" });
    }

    const result = await db.$client.query(
      `SELECT "id", "status", "uptime_ms" AS "uptimeMs", "requests_total" AS "requestsTotal", "error_total" AS "errorTotal", "created_at" AS "createdAt"
       FROM "worker_sync_event"
       WHERE "worker_id" = $1 AND "created_at" >= NOW() - INTERVAL '1 hour' * $2
       ORDER BY "created_at" ASC
       LIMIT 5000`,
      [existingWorker.id, hours],
    );

    return { events: result.rows };
  })
  .post("/api/workers/sync", async ({ request, body, status }) => {
    const syncToken = getBearerToken(request.headers);
    if (!syncToken) {
      logWarn("worker sync denied: missing bearer token");
      return status(401, { error: "Unauthorized" });
    }

    const workerIdFromToken = parseWorkerIdFromSyncToken(syncToken);
    if (!workerIdFromToken) {
      logWarn("worker sync denied: invalid token format");
      return status(401, { error: "Unauthorized" });
    }

    const parsed = syncWorkerStatsSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("worker sync rejected: invalid payload", { workerId: workerIdFromToken });
      return status(400, { error: "Invalid sync payload" });
    }

    const currentWorker = await db.query.worker.findFirst({
      where: (table, { eq }) => eq(table.id, workerIdFromToken),
      columns: {
        id: true,
        syncTokenHash: true,
      },
    });

    if (!currentWorker || !verifySyncToken(syncToken, currentWorker.syncTokenHash)) {
      logWarn("worker sync denied: token verification failed", { workerId: workerIdFromToken });
      return status(401, { error: "Unauthorized" });
    }

    await db.$client.query(
      `UPDATE "worker"
       SET "status" = $1, "last_seen_at" = NOW(), "uptime_ms" = $2, "requests_total" = $3, "error_total" = $4, "endpoint" = $5, "sync_token" = $6, "updated_at" = NOW()
       WHERE "id" = $7`,
      [
        parsed.data.status,
        parsed.data.uptimeMs,
        parsed.data.requestsTotal,
        parsed.data.errorTotal,
        parsed.data.endpoint ?? null,
        syncToken,
        currentWorker.id,
      ],
    );

    await db.$client.query(
      `INSERT INTO "worker_sync_event" ("id", "worker_id", "status", "uptime_ms", "requests_total", "error_total", "created_at")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
      [
        currentWorker.id,
        parsed.data.status,
        parsed.data.uptimeMs,
        parsed.data.requestsTotal,
        parsed.data.errorTotal,
      ],
    );

    const persistedWorker = await db.query.worker.findFirst({
      where: (table, { eq }) => eq(table.id, currentWorker.id),
      columns: {
        endpoint: true,
        syncToken: true,
        lastSeenAt: true,
        status: true,
      },
    });

    logInfo("worker sync updated", {
      workerId: currentWorker.id,
      status: parsed.data.status,
      endpoint: parsed.data.endpoint ?? null,
      endpointPersisted: persistedWorker?.endpoint ?? null,
      hasSyncTokenPersisted: Boolean(persistedWorker?.syncToken),
      persistedStatus: persistedWorker?.status ?? null,
      persistedLastSeenAt: persistedWorker?.lastSeenAt
        ? persistedWorker.lastSeenAt.toISOString()
        : null,
      uptimeMs: parsed.data.uptimeMs,
      requestsTotal: parsed.data.requestsTotal,
      errorTotal: parsed.data.errorTotal,
    });
    if (!persistedWorker?.endpoint) {
      logWarn("worker sync persisted without endpoint", { workerId: currentWorker.id });
    }

    return status(204);
  })
  .post("/api/workers/:id/rotate-sync-token", async ({ request, params, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedParams = rotateTokenParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      return status(400, { error: "Invalid worker id" });
    }

    const existingWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, parsedParams.data.id), eq(table.userId, user.id)),
      columns: {
        id: true,
      },
    });

    if (!existingWorker) {
      return status(404, { error: "Worker not found" });
    }

    const nextSyncToken = generateSyncToken(existingWorker.id);
    const syncTokenHash = hashSyncToken(nextSyncToken);

    await db.$client.query(
      `UPDATE "worker" SET "sync_token_hash" = $1, "sync_token" = $2, "updated_at" = NOW() WHERE "id" = $3`,
      [syncTokenHash, nextSyncToken, existingWorker.id],
    );

    logInfo("worker sync token rotated", { workerId: existingWorker.id, userId: user.id });
    return { syncToken: nextSyncToken };
  });
