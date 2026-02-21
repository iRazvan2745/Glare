import { db } from "@glare/db";
import { backupPlan } from "@glare/db/schema/backup-plans";
import { backupPlanRun } from "@glare/db/schema/backup-plan-runs";
import { backupEvent } from "@glare/db/schema/backup-events";
import { workerSyncEvent } from "@glare/db/schema/worker-sync-events";
import { worker } from "@glare/db/schema/workers";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { type } from "arktype";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { logInfo, logWarn } from "../../shared/logger";
import { detectBackupSizeAnomaly, recordBackupMetric } from "../../shared/backup-metrics";
import { sendDiscordNotification } from "../../shared/notifications";
import { recordStorageUsageSample } from "../../shared/storage-usage";

const workerIdType = type("string.uuid");
const createWorkerType = type({ name: "string", "region?": "string" });
const updateWorkerType = type({ name: "string", "region?": "string | null" });
const rotateTokenParamsType = type({ id: "string.uuid" });
const workerParamsType = type({ id: "string.uuid" });
const syncWorkerStatsType = type({
  status: '"online" | "degraded"',
  "endpoint?": "string.url <= 2048",
  uptimeMs: "number.integer >= 0",
  requestsTotal: "number.integer >= 0",
  errorTotal: "number.integer >= 0",
});
const claimBackupRunsType = type({
  "limit?": "number.integer >= 1",
});
const completeBackupRunType = type({
  status: '"success" | "failed"',
  "error?": "string <= 4096 | null",
  "durationMs?": "number.integer >= 0",
  "snapshotId?": "string <= 512 | null",
  "snapshotTime?": "string | null",
  "output?": "unknown",
});
const reportBackupPlanRunType = type({
  status: '"success" | "failed"',
  "error?": "string <= 4096 | null",
  "durationMs?": "number.integer >= 0",
  "snapshotId?": "string <= 512 | null",
  "snapshotTime?": "string | null",
  "nextRunAt?": "string | null",
  "output?": "unknown",
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
    const region = data.region?.trim() || null;
    if (region && region.length > 120) {
      return { success: false as const };
    }
    return { success: true as const, data: { name, region } };
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
    const region = data.region === null ? null : data.region?.trim() || undefined;
    if (region && region.length > 120) {
      return { success: false as const };
    }
    return { success: true as const, data: { name, region } };
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
const claimBackupRunsSchema = {
  safeParse(input: unknown) {
    if (!claimBackupRunsType.allows(input ?? {})) {
      return { success: false as const };
    }
    return {
      success: true as const,
      data: (input ?? {}) as typeof claimBackupRunsType.infer,
    };
  },
};
const completeBackupRunSchema = {
  safeParse(input: unknown) {
    if (!completeBackupRunType.allows(input ?? {})) {
      return { success: false as const };
    }
    const data = (input ?? {}) as typeof completeBackupRunType.infer;
    if (data.snapshotTime) {
      const parsed = new Date(data.snapshotTime);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false as const };
      }
    }
    return { success: true as const, data };
  },
};
const reportBackupPlanRunSchema = {
  safeParse(input: unknown) {
    if (!reportBackupPlanRunType.allows(input ?? {})) {
      return { success: false as const };
    }
    const data = (input ?? {}) as typeof reportBackupPlanRunType.infer;
    if (data.snapshotTime) {
      const parsed = new Date(data.snapshotTime);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false as const };
      }
    }
    if (data.nextRunAt) {
      const parsed = new Date(data.nextRunAt);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false as const };
      }
    }
    return { success: true as const, data };
  },
};

const WORKER_ONLINE_THRESHOLD_MS = 45_000;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

type PlanPathsConfig = {
  defaultPaths: string[];
  workerPaths: Record<string, string[]>;
};

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
  region: string | null;
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
    region: record.region,
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

async function authenticateWorkerFromSyncToken(headers: Headers) {
  const syncToken = getBearerToken(headers);
  if (!syncToken) {
    return null;
  }

  const workerIdFromToken = parseWorkerIdFromSyncToken(syncToken);
  if (!workerIdFromToken) {
    return null;
  }

  const currentWorker = await db.query.worker.findFirst({
    where: (table, { eq }) => eq(table.id, workerIdFromToken),
    columns: {
      id: true,
      syncTokenHash: true,
    },
  });

  if (!currentWorker || !verifySyncToken(syncToken, currentWorker.syncTokenHash)) {
    return null;
  }

  return { workerId: currentWorker.id, syncToken };
}

function parseOptionsJson(optionsJson: string | null): Record<string, string> {
  if (!optionsJson) return {};
  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const nextOptions: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        nextOptions[key] = value;
      }
    }
    return nextOptions;
  } catch {
    return {};
  }
}

function parseStringArrayJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function normalizePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function parsePlanPathsConfig(value: string | null): PlanPathsConfig {
  if (!value) {
    return { defaultPaths: [], workerPaths: {} };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return {
        defaultPaths: normalizePaths(
          parsed.filter((item): item is string => typeof item === "string"),
        ),
        workerPaths: {},
      };
    }
    if (!parsed || typeof parsed !== "object") {
      return { defaultPaths: [], workerPaths: {} };
    }
    const record = parsed as Record<string, unknown>;
    const defaultPaths = Array.isArray(record.defaultPaths)
      ? normalizePaths(
          record.defaultPaths.filter((item): item is string => typeof item === "string"),
        )
      : [];
    const workerPaths: Record<string, string[]> = {};
    const rawWorkerPaths = record.workerPaths;
    if (rawWorkerPaths && typeof rawWorkerPaths === "object" && !Array.isArray(rawWorkerPaths)) {
      for (const [workerId, workerValue] of Object.entries(
        rawWorkerPaths as Record<string, unknown>,
      )) {
        if (!Array.isArray(workerValue)) continue;
        const nextPaths = normalizePaths(
          workerValue.filter((item): item is string => typeof item === "string"),
        );
        if (nextPaths.length > 0) {
          workerPaths[workerId] = nextPaths;
        }
      }
    }

    return { defaultPaths, workerPaths };
  } catch {
    return { defaultPaths: [], workerPaths: {} };
  }
}

function resolvePathsForWorker(config: PlanPathsConfig, workerId: string) {
  const workerSpecific = config.workerPaths[workerId];
  if (workerSpecific && workerSpecific.length > 0) {
    return workerSpecific;
  }
  return config.defaultPaths;
}

function hasRcloneOptions(options: Record<string, string>) {
  return Object.keys(options).some(
    (key) => key === "rclone.type" || key.startsWith("rclone.config."),
  );
}

function hasLegacyS3Options(options: Record<string, string>) {
  return Object.keys(options).some((key) => key.startsWith("s3."));
}

function enrichRcloneOptionsFromS3(options: Record<string, string>) {
  const next = { ...options };
  if (!next["rclone.type"]) {
    next["rclone.type"] = "s3";
  }

  const mappings: Array<[string, string]> = [
    ["s3.endpoint", "endpoint"],
    ["s3.region", "region"],
    ["s3.access-key-id", "access_key_id"],
    ["s3.secret-access-key", "secret_access_key"],
    ["s3.session-token", "session_token"],
    ["s3.profile", "profile"],
    ["s3.storage-class", "storage_class"],
    ["s3.acl", "acl"],
  ];

  for (const [source, target] of mappings) {
    if (!next[source]) continue;
    const rcloneKey = `rclone.config.${target}`;
    if (!next[rcloneKey]) {
      next[rcloneKey] = next[source];
    }
  }

  if (next["s3.path-style"] === "true" && !next["rclone.config.force_path_style"]) {
    next["rclone.config.force_path_style"] = "true";
  }
  if (next["s3.disable-tls"] === "true" && !next["rclone.config.use_ssl"]) {
    next["rclone.config.use_ssl"] = "false";
  }
  if (next["s3.no-verify-ssl"] === "true" && !next["rclone.config.no_check_certificate"]) {
    next["rclone.config.no_check_certificate"] = "true";
  }
  if (!next["rclone.config.provider"]) {
    const endpoint = next["s3.endpoint"]?.toLowerCase() || "";
    next["rclone.config.provider"] = endpoint.includes("r2.cloudflarestorage.com")
      ? "Cloudflare"
      : "AWS";
  }

  return next;
}

function normalizeRcloneRepository(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  const trimmedPath = repositoryPath.trim();
  const remoteFromOption = options["rclone.remote"]?.trim() || null;

  if (trimmedPath.startsWith("rclone:")) {
    const rest = trimmedPath.slice("rclone:".length);
    const separatorIndex = rest.indexOf(":");
    const remoteFromPath = separatorIndex >= 0 ? rest.slice(0, separatorIndex).trim() : "";
    const remote = remoteFromOption || remoteFromPath || `glare-${repositoryId.slice(0, 8)}`;
    options["rclone.remote"] = remote;
    return trimmedPath;
  }

  const remote = remoteFromOption || `glare-${repositoryId.slice(0, 8)}`;
  const normalizedPath = trimmedPath.replace(/^\/+/, "");
  options["rclone.remote"] = remote;
  return `rclone:${remote}:${normalizedPath}`;
}

function deriveRcloneRepositoryForInit(
  repositoryPath: string,
  repositoryId: string,
  options: Record<string, string>,
) {
  if (repositoryPath.startsWith("rclone:")) {
    return normalizeRcloneRepository(repositoryPath, repositoryId, options);
  }

  const remote = options["rclone.remote"]?.trim() || `glare-${repositoryId.slice(0, 8)}`;
  options["rclone.remote"] = remote;

  if (repositoryPath.startsWith("s3:")) {
    const bucketFromOptions = options["s3.bucket"]?.trim().replace(/^\/+|\/+$/g, "") || "";
    const prefixFromOptions = options["s3.prefix"]?.trim().replace(/^\/+|\/+$/g, "") || "";
    if (bucketFromOptions) {
      return `rclone:${remote}:${bucketFromOptions}${prefixFromOptions ? `/${prefixFromOptions}` : ""}`;
    }

    const raw = repositoryPath.slice("s3:".length).trim();
    let pathPart = raw;
    try {
      if (raw.includes("://")) {
        pathPart = new URL(raw).pathname;
      } else if (raw.includes("/")) {
        pathPart = raw.slice(raw.indexOf("/"));
      }
    } catch {
      pathPart = raw;
    }
    pathPart = pathPart.replace(/^\/+|\/+$/g, "");
    return `rclone:${remote}:${pathPart}`;
  }

  return normalizeRcloneRepository(repositoryPath, repositoryId, options);
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
        region: true,
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
        region: parsed.data.region,
        syncTokenHash,
      })
      .returning({
        id: worker.id,
        name: worker.name,
        region: worker.region,
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

    const [updatedWorker] = await db
      .update(worker)
      .set({
        name: parsedBody.data.name,
        ...(parsedBody.data.region !== undefined ? { region: parsedBody.data.region } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(worker.id, existingWorker.id), eq(worker.userId, user.id)))
      .returning({
        id: worker.id,
        name: worker.name,
        region: worker.region,
        status: worker.status,
        lastSeenAt: worker.lastSeenAt,
        uptimeMs: worker.uptimeMs,
        requestsTotal: worker.requestsTotal,
        errorTotal: worker.errorTotal,
        createdAt: worker.createdAt,
        updatedAt: worker.updatedAt,
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

    await db.delete(worker).where(eq(worker.id, existingWorker.id));

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
    const limitParam = Number(query?.limit) || 300;
    const limit = Math.max(1, Math.min(1000, limitParam));
    const offsetParam = Number(query?.offset) || 0;
    const offset = Math.max(0, Math.min(50_000, offsetParam));
    const rawStatus = typeof query?.status === "string" ? query.status.trim().toLowerCase() : "all";
    const statusFilter =
      rawStatus === "online" || rawStatus === "degraded" || rawStatus === "offline"
        ? rawStatus
        : "all";

    const existingWorker = await db.query.worker.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, parsedParams.data.id), eq(table.userId, user.id)),
      columns: { id: true },
    });

    if (!existingWorker) {
      return status(404, { error: "Worker not found" });
    }

    const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    const whereClauses = [
      eq(workerSyncEvent.workerId, existingWorker.id),
      gte(workerSyncEvent.createdAt, sinceDate),
    ];

    if (statusFilter !== "all") {
      whereClauses.push(eq(workerSyncEvent.status, statusFilter));
    }

    const whereExpression = and(...whereClauses);

    const [countRows, eventRowsDesc] = await Promise.all([
      db.select({ total: count() }).from(workerSyncEvent).where(whereExpression),
      db
        .select({
          id: workerSyncEvent.id,
          status: workerSyncEvent.status,
          uptimeMs: workerSyncEvent.uptimeMs,
          requestsTotal: workerSyncEvent.requestsTotal,
          errorTotal: workerSyncEvent.errorTotal,
          createdAt: workerSyncEvent.createdAt,
        })
        .from(workerSyncEvent)
        .where(whereExpression)
        .orderBy(desc(workerSyncEvent.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const events = [...eventRowsDesc].sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );

    return {
      events,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + events.length < total,
      },
    };
  })
  .post("/api/workers/sync", async ({ request, body, status }) => {
    const auth = await authenticateWorkerFromSyncToken(request.headers);
    if (!auth) {
      logWarn("worker sync denied: token verification failed");
      return status(401, { error: "Unauthorized" });
    }

    const parsed = syncWorkerStatsSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("worker sync rejected: invalid payload", { workerId: auth.workerId });
      return status(400, { error: "Invalid sync payload" });
    }

    const previousWorkerState = await db.query.worker.findFirst({
      where: (table, { eq }) => eq(table.id, auth.workerId),
      columns: {
        id: true,
        userId: true,
        name: true,
        status: true,
      },
    });

    await db.transaction(async (tx) => {
      await tx
        .update(worker)
        .set({
          status: parsed.data.status,
          lastSeenAt: new Date(),
          uptimeMs: parsed.data.uptimeMs,
          requestsTotal: parsed.data.requestsTotal,
          errorTotal: parsed.data.errorTotal,
          endpoint: parsed.data.endpoint ?? null,
          updatedAt: new Date(),
        })
        .where(eq(worker.id, auth.workerId));

      await tx.insert(workerSyncEvent).values({
        id: crypto.randomUUID(),
        workerId: auth.workerId,
        status: parsed.data.status,
        uptimeMs: parsed.data.uptimeMs,
        requestsTotal: parsed.data.requestsTotal,
        errorTotal: parsed.data.errorTotal,
        createdAt: new Date(),
      });

      await tx.execute(sql`
        DELETE FROM "worker_sync_event"
        WHERE "worker_id" = ${auth.workerId}
          AND "id" NOT IN (
            SELECT "id" FROM "worker_sync_event"
            WHERE "worker_id" = ${auth.workerId}
            ORDER BY "created_at" DESC
            LIMIT 10000
          )
      `);
    });

    const persistedWorker = await db.query.worker.findFirst({
      where: (table, { eq }) => eq(table.id, auth.workerId),
      columns: {
        endpoint: true,
        lastSeenAt: true,
        status: true,
      },
    });

    logInfo("worker sync updated", {
      workerId: auth.workerId,
      status: parsed.data.status,
      endpoint: parsed.data.endpoint ?? null,
      endpointPersisted: persistedWorker?.endpoint ?? null,
      persistedStatus: persistedWorker?.status ?? null,
      persistedLastSeenAt: persistedWorker?.lastSeenAt
        ? persistedWorker.lastSeenAt.toISOString()
        : null,
      uptimeMs: parsed.data.uptimeMs,
      requestsTotal: parsed.data.requestsTotal,
      errorTotal: parsed.data.errorTotal,
    });
    if (!persistedWorker?.endpoint) {
      logWarn("worker sync persisted without endpoint", { workerId: auth.workerId });
    }

    if (
      previousWorkerState &&
      previousWorkerState.status !== parsed.data.status &&
      parsed.data.status === "degraded"
    ) {
      const delivered = await sendDiscordNotification({
        userId: previousWorkerState.userId,
        category: "worker_health",
        title: "Worker degraded",
        message: `Worker ${previousWorkerState.name} transitioned to degraded state.`,
        severity: "warning",
        fields: [
          { name: "Worker", value: previousWorkerState.name },
          { name: "Worker ID", value: previousWorkerState.id },
          { name: "Previous status", value: previousWorkerState.status },
          { name: "Current status", value: parsed.data.status },
        ],
      });
      if (!delivered) {
        logWarn("worker degraded notification not delivered", {
          userId: previousWorkerState.userId,
          category: "worker_health",
          workerId: previousWorkerState.id,
        });
      }
    }

    return status(204);
  })
  .post("/api/workers/backup-plans/sync", async ({ request, status }) => {
    const auth = await authenticateWorkerFromSyncToken(request.headers);
    if (!auth) {
      return status(401, { error: "Unauthorized" });
    }

    const rows = await db.$client.query(
      `SELECT
         p.id,
         p.user_id AS "userId",
         p.repository_id AS "repositoryId",
         p.name,
         p.cron,
         p.paths_json AS "pathsJson",
         p.tags_json AS "tagsJson",
         p.dry_run AS "dryRun",
         p.enabled,
         p.updated_at AS "updatedAt",
         r.backend,
         r.repository,
         r.password,
         r.options_json AS "optionsJson"
       FROM "backup_plan" p
       INNER JOIN "backup_plan_worker" pw ON pw.plan_id = p.id
       INNER JOIN "rustic_repository_backup_worker" rbw
         ON rbw.repository_id = p.repository_id
         AND rbw.worker_id = pw.worker_id
       INNER JOIN "rustic_repository" r ON r.id = p.repository_id
       WHERE pw.worker_id = $1 AND p.enabled = true
       ORDER BY p.updated_at DESC`,
      [auth.workerId],
    );

    const plans = (
      rows.rows as Array<{
        id: string;
        userId: string;
        repositoryId: string;
        name: string;
        cron: string;
        pathsJson: string | null;
        tagsJson: string | null;
        dryRun: boolean;
        enabled: boolean;
        updatedAt: Date | string;
        backend: string;
        repository: string;
        password: string | null;
        optionsJson: string | null;
      }>
    )
      .map((row) => {
        const pathsConfig = parsePlanPathsConfig(row.pathsJson);
        const paths = resolvePathsForWorker(pathsConfig, auth.workerId);
        if (paths.length === 0) {
          return null;
        }

        const rawOptions = parseOptionsJson(row.optionsJson);
        const backupOptions = hasRcloneOptions(rawOptions)
          ? rawOptions
          : row.backend === "s3" && hasLegacyS3Options(rawOptions)
            ? enrichRcloneOptionsFromS3(rawOptions)
            : rawOptions;
        const shouldForceRcloneBackup =
          row.backend === "rclone" ||
          (row.backend === "s3" &&
            (hasRcloneOptions(backupOptions) || hasLegacyS3Options(backupOptions)));
        const backend = shouldForceRcloneBackup ? "rclone" : row.backend;
        const repository = shouldForceRcloneBackup
          ? deriveRcloneRepositoryForInit(row.repository, row.repositoryId, backupOptions)
          : row.repository;

        return {
          id: row.id,
          userId: row.userId,
          repositoryId: row.repositoryId,
          name: row.name,
          cron: row.cron,
          enabled: row.enabled,
          updatedAt: new Date(row.updatedAt).toISOString(),
          request: {
            backend,
            options: backupOptions,
            repository,
            password: row.password ?? undefined,
            paths,
            tags: parseStringArrayJson(row.tagsJson),
            dryRun: row.dryRun,
          },
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    return { plans };
  })
  .post("/api/workers/backup-plans/:id/report", async ({ request, params, body, status }) => {
    const auth = await authenticateWorkerFromSyncToken(request.headers);
    if (!auth) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedPlanId = workerIdSchema.safeParse(params.id);
    if (!parsedPlanId.success) {
      return status(400, { error: "Invalid plan id" });
    }

    const parsedBody = reportBackupPlanRunSchema.safeParse(body);
    if (!parsedBody.success) {
      return status(400, { error: "Invalid report payload" });
    }

    const planRecord = await db.$client.query(
      `SELECT p.id, p.user_id AS "userId", p.repository_id AS "repositoryId"
       FROM "backup_plan" p
       INNER JOIN "backup_plan_worker" pw ON pw.plan_id = p.id
       WHERE p.id = $1 AND pw.worker_id = $2
       LIMIT 1`,
      [parsedPlanId.data, auth.workerId],
    );

    const plan = planRecord.rows[0] as
      | {
          id: string;
          userId: string;
          repositoryId: string;
        }
      | undefined;
    if (!plan) {
      return status(404, { error: "Backup plan not found for worker" });
    }

    const runId = crypto.randomUUID();
    const startedAt = new Date(Date.now() - (parsedBody.data.durationMs ?? 0));
    const finishedAt = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(backupPlanRun).values({
        id: runId,
        planId: plan.id,
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        workerId: auth.workerId,
        type: "backup",
        status: parsedBody.data.status,
        error: parsedBody.data.error ?? null,
        durationMs: parsedBody.data.durationMs ?? null,
        snapshotId: parsedBody.data.snapshotId ?? null,
        snapshotTime: parsedBody.data.snapshotTime ? new Date(parsedBody.data.snapshotTime) : null,
        outputJson: parsedBody.data.output ? JSON.stringify(parsedBody.data.output) : null,
        startedAt,
        finishedAt,
      });

      await tx.insert(backupEvent).values({
        id: crypto.randomUUID(),
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        planId: plan.id,
        runId,
        workerId: auth.workerId,
        type: parsedBody.data.status === "success" ? "backup_completed" : "backup_failed",
        status: parsedBody.data.status === "success" ? "resolved" : "open",
        severity: parsedBody.data.status === "success" ? "info" : "error",
        message:
          parsedBody.data.status === "success"
            ? "Backup completed"
            : parsedBody.data.error || "Backup command failed",
        detailsJson: JSON.stringify({
          snapshotId: parsedBody.data.snapshotId ?? null,
          snapshotTime: parsedBody.data.snapshotTime ?? null,
        }),
      });
    });

    if (parsedBody.data.status === "success") {
      await recordStorageUsageSample({
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        runId,
        output: parsedBody.data.output ?? null,
      });
      const metric = await recordBackupMetric({
        runId,
        userId: plan.userId,
        repositoryId: plan.repositoryId,
        planId: plan.id,
        workerId: auth.workerId,
        snapshotId: parsedBody.data.snapshotId ?? null,
        snapshotTime: parsedBody.data.snapshotTime ? new Date(parsedBody.data.snapshotTime) : null,
        output: parsedBody.data.output ?? null,
      });
      if (metric) {
        const anomaly = await detectBackupSizeAnomaly({
          metricId: metric.id,
          userId: plan.userId,
          planId: plan.id,
          repositoryId: plan.repositoryId,
          actualBytes: metric.bytesAdded,
        });
        if (anomaly) {
          await db.insert(backupEvent).values({
            id: crypto.randomUUID(),
            userId: plan.userId,
            repositoryId: plan.repositoryId,
            planId: plan.id,
            runId,
            workerId: auth.workerId,
            type: "backup_size_anomaly",
            status: "open",
            severity: anomaly.severity,
            message: `Backup size anomaly detected (${anomaly.reason})`,
            detailsJson: JSON.stringify({
              expectedBytes: anomaly.expectedBytes,
              actualBytes: metric.bytesAdded,
              score: anomaly.score,
            }),
          });
        }
      }
    }

    if (parsedBody.data.status === "failed") {
      const delivered = await sendDiscordNotification({
        userId: plan.userId,
        category: "backup_failures",
        title: "Backup plan run failed",
        message: parsedBody.data.error || "Backup command failed",
        severity: "error",
        fields: [
          { name: "Plan ID", value: plan.id },
          { name: "Repository ID", value: plan.repositoryId },
          { name: "Worker ID", value: auth.workerId },
        ],
      });
      if (!delivered) {
        logWarn("backup failure notification not delivered", {
          userId: plan.userId,
          category: "backup_failures",
          planId: plan.id,
          workerId: auth.workerId,
        });
      }
    }

    await db
      .update(backupPlan)
      .set({
        lastRunAt: finishedAt,
        lastStatus: parsedBody.data.status,
        lastError:
          parsedBody.data.status === "success" ? null : (parsedBody.data.error ?? "Backup failed"),
        lastDurationMs: parsedBody.data.durationMs ?? null,
        nextRunAt: parsedBody.data.nextRunAt ? new Date(parsedBody.data.nextRunAt) : null,
      })
      .where(eq(backupPlan.id, plan.id));

    return status(204);
  })
  .post("/api/workers/backup-runs/claim", async ({ request, body, status }) => {
    const auth = await authenticateWorkerFromSyncToken(request.headers);
    if (!auth) {
      return status(401, { error: "Unauthorized" });
    }

    const parsed = claimBackupRunsSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { error: "Invalid claim payload" });
    }
    const limit = Math.max(1, Math.min(20, parsed.data.limit ?? 3));

    const claimed = await db.$client.query(
      `WITH next_runs AS (
         SELECT "id"
         FROM "backup_plan_run"
         WHERE "worker_id" = $1
           AND "status" = 'pending'
           AND "type" = 'backup'
         ORDER BY "started_at" ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "backup_plan_run" AS "run"
       SET "status" = 'running', "started_at" = NOW()
       FROM next_runs
       WHERE "run"."id" = next_runs."id"
       RETURNING
         "run"."id",
         "run"."plan_id" AS "planId",
         "run"."repository_id" AS "repositoryId",
         "run"."output_json" AS "outputJson"`,
      [auth.workerId, limit],
    );

    const runs = [];
    for (const row of claimed.rows as Array<{
      id: string;
      planId: string;
      repositoryId: string;
      outputJson: string | null;
    }>) {
      try {
        const parsedOutput = row.outputJson
          ? (JSON.parse(row.outputJson) as { request?: unknown })
          : {};
        if (!parsedOutput.request || typeof parsedOutput.request !== "object") {
          throw new Error("missing request payload");
        }
        runs.push({
          id: row.id,
          planId: row.planId,
          repositoryId: row.repositoryId,
          request: parsedOutput.request,
        });
      } catch {
        await db.$client.query(
          `UPDATE "backup_plan_run"
           SET "status" = 'failed', "error" = $1, "finished_at" = NOW()
           WHERE "id" = $2`,
          ["Invalid queued run payload", row.id],
        );
      }
    }

    return { runs };
  })
  .post("/api/workers/backup-runs/:id/complete", async ({ request, params, body, status }) => {
    const auth = await authenticateWorkerFromSyncToken(request.headers);
    if (!auth) {
      return status(401, { error: "Unauthorized" });
    }

    const parsedParams = workerIdSchema.safeParse(params.id);
    if (!parsedParams.success) {
      return status(400, { error: "Invalid run id" });
    }

    const parsedBody = completeBackupRunSchema.safeParse(body);
    if (!parsedBody.success) {
      return status(400, { error: "Invalid completion payload" });
    }

    const completedAt = new Date();
    const completed = await db.$client.query(
      `UPDATE "backup_plan_run"
       SET
         "status" = $1,
         "error" = $2,
         "duration_ms" = $3,
         "snapshot_id" = $4,
         "snapshot_time" = $5,
         "output_json" = $6,
         "finished_at" = $7
       WHERE
         "id" = $8
         AND "worker_id" = $9
         AND "status" = 'running'
       RETURNING
         "id" AS "runId",
         "plan_id" AS "planId",
         "user_id" AS "userId",
         "repository_id" AS "repositoryId",
         "run_group_id" AS "runGroupId"`,
      [
        parsedBody.data.status,
        parsedBody.data.error ?? null,
        parsedBody.data.durationMs ?? null,
        parsedBody.data.snapshotId ?? null,
        parsedBody.data.snapshotTime ? new Date(parsedBody.data.snapshotTime) : null,
        parsedBody.data.output ? JSON.stringify(parsedBody.data.output) : null,
        completedAt,
        parsedParams.data,
        auth.workerId,
      ],
    );

    const completionRow = completed.rows[0] as
      | {
          runId: string;
          planId: string;
          userId: string;
          repositoryId: string;
          runGroupId: string | null;
        }
      | undefined;
    if (!completionRow) {
      return status(404, { error: "Running backup run not found" });
    }

    if (parsedBody.data.status === "success") {
      await recordStorageUsageSample({
        userId: completionRow.userId,
        repositoryId: completionRow.repositoryId,
        runId: completionRow.runId,
        output: parsedBody.data.output ?? null,
      });
      const metric = await recordBackupMetric({
        runId: completionRow.runId,
        userId: completionRow.userId,
        repositoryId: completionRow.repositoryId,
        planId: completionRow.planId,
        workerId: auth.workerId,
        snapshotId: parsedBody.data.snapshotId ?? null,
        snapshotTime: parsedBody.data.snapshotTime ? new Date(parsedBody.data.snapshotTime) : null,
        output: parsedBody.data.output ?? null,
      });
      if (metric) {
        const anomaly = await detectBackupSizeAnomaly({
          metricId: metric.id,
          userId: completionRow.userId,
          planId: completionRow.planId,
          repositoryId: completionRow.repositoryId,
          actualBytes: metric.bytesAdded,
        });
        if (anomaly) {
          await db.insert(backupEvent).values({
            id: crypto.randomUUID(),
            userId: completionRow.userId,
            repositoryId: completionRow.repositoryId,
            planId: completionRow.planId,
            runId: completionRow.runId,
            workerId: auth.workerId,
            type: "backup_size_anomaly",
            status: "open",
            severity: anomaly.severity,
            message: `Backup size anomaly detected (${anomaly.reason})`,
            detailsJson: JSON.stringify({
              expectedBytes: anomaly.expectedBytes,
              actualBytes: metric.bytesAdded,
              score: anomaly.score,
            }),
          });
        }
      }
    }

    if (!completionRow.runGroupId) {
      return status(204);
    }

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT "id"
        FROM "backup_plan"
        WHERE "id" = ${completionRow.planId}
        FOR UPDATE
      `);

      const summaryResult = await tx.execute(sql`
        SELECT
          COUNT(*)::int AS "totalCount",
          SUM(CASE WHEN "status" = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
          SUM(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END)::int AS "failureCount",
          SUM(CASE WHEN "status" IN ('pending', 'running') THEN 1 ELSE 0 END)::int AS "unfinishedCount",
          MIN("started_at") AS "firstStartedAt",
          MAX("finished_at") AS "lastFinishedAt",
          MAX("error") FILTER (WHERE "status" = 'failed' AND "error" IS NOT NULL) AS "lastError"
        FROM "backup_plan_run"
        WHERE "run_group_id" = ${completionRow.runGroupId} AND "plan_id" = ${completionRow.planId}
      `);

      const summaryRow = summaryResult.rows[0] as Record<string, unknown> | undefined;
      const unfinishedCount = Number(summaryRow?.unfinishedCount ?? 0);
      if (!summaryRow || unfinishedCount > 0) {
        return;
      }

      const totalCount = Number(summaryRow.totalCount ?? 0);
      const successCount = Number(summaryRow.successCount ?? 0);
      const failureCount = Number(summaryRow.failureCount ?? 0);
      const firstStartedAtRaw = summaryRow.firstStartedAt as string | Date | null | undefined;
      const lastFinishedAtRaw = summaryRow.lastFinishedAt as string | Date | null | undefined;
      const lastError = summaryRow.lastError as string | null | undefined;

      const firstStartedAt = firstStartedAtRaw ? new Date(firstStartedAtRaw) : null;
      const lastFinishedAt = lastFinishedAtRaw ? new Date(lastFinishedAtRaw) : null;
      const durationMs =
        firstStartedAt && lastFinishedAt
          ? Math.max(0, lastFinishedAt.getTime() - firstStartedAt.getTime())
          : null;
      const finalStatus = failureCount > 0 ? "failed" : "success";
      const finalError =
        failureCount === 0
          ? null
          : successCount === 0
            ? lastError || "Backup failed"
            : `${failureCount}/${totalCount} workers failed`;

      await tx
        .update(backupPlan)
        .set({
          lastRunAt: lastFinishedAt,
          lastStatus: finalStatus,
          lastError: finalError,
          lastDurationMs: durationMs,
        })
        .where(eq(backupPlan.id, completionRow.planId));
    });

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
      `UPDATE "worker" SET "sync_token_hash" = $1, "updated_at" = NOW() WHERE "id" = $2`,
      [syncTokenHash, existingWorker.id],
    );

    logInfo("worker sync token rotated", { workerId: existingWorker.id, userId: user.id });
    return { syncToken: nextSyncToken };
  });
