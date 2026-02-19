import { db } from "@glare/db";
import { backupEvent } from "@glare/db/schema/backup-events";
import { workerSyncEvent } from "@glare/db/schema/worker-sync-events";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { Elysia } from "elysia";

import { getAuthenticatedUser } from "../../shared/auth/session";

const RANGE_TO_HOURS = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
} as const;

const RANGE_TO_BUCKETS = {
  "1h": 24,
  "6h": 48,
  "24h": 96,
  "7d": 168,
} as const;

type RangeValue = keyof typeof RANGE_TO_HOURS;

function clampRange(value: unknown): RangeValue {
  if (value === "1h" || value === "6h" || value === "24h" || value === "7d") {
    return value;
  }
  return "24h";
}

function bucketizeSyncEvents(
  points: Array<{ createdAt: Date; requestsTotal: number; errorTotal: number }>,
  range: RangeValue,
) {
  if (points.length === 0) {
    return [] as Array<{ timestamp: string; requests: number; errors: number }>;
  }

  const startMs = Date.now() - RANGE_TO_HOURS[range] * 60 * 60 * 1000;
  const endMs = Date.now();
  const bucketCount = RANGE_TO_BUCKETS[range];
  const bucketSize = Math.max(1, Math.floor((endMs - startMs) / bucketCount));

  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    timestamp: new Date(startMs + index * bucketSize).toISOString(),
    requests: 0,
    errors: 0,
    hasData: false,
  }));

  for (const point of points) {
    const pointMs = new Date(point.createdAt).getTime();
    if (pointMs < startMs || pointMs > endMs) {
      continue;
    }
    const idx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((pointMs - startMs) / bucketSize)),
    );
    const bucket = buckets[idx];
    if (!bucket) {
      continue;
    }
    bucket.requests += point.requestsTotal;
    bucket.errors += point.errorTotal;
    bucket.hasData = true;
  }

  return buckets
    .filter((bucket) => bucket.hasData)
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      requests: bucket.requests,
      errors: bucket.errors,
    }));
}

export const observabilityRoutes = new Elysia()
  .get("/api/observability/overview", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const range = clampRange(query?.range);
    const sinceDate = new Date(Date.now() - RANGE_TO_HOURS[range] * 60 * 60 * 1000);

    const workers = await db.query.worker.findMany({
      where: (table, { eq: equals }) => equals(table.userId, user.id),
      columns: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
      },
      orderBy: (table, { desc: orderDesc }) => [orderDesc(table.updatedAt)],
    });

    const workerIds = workers.map((currentWorker) => currentWorker.id);

    const syncEvents =
      workerIds.length > 0
        ? await db
            .select({
              createdAt: workerSyncEvent.createdAt,
              requestsTotal: workerSyncEvent.requestsTotal,
              errorTotal: workerSyncEvent.errorTotal,
            })
            .from(workerSyncEvent)
            .where(
              and(
                inArray(workerSyncEvent.workerId, workerIds),
                gte(workerSyncEvent.createdAt, sinceDate),
              ),
            )
            .orderBy(desc(workerSyncEvent.createdAt))
            .limit(4_000)
        : [];

    const incidents = await db
      .select({
        id: backupEvent.id,
        type: backupEvent.type,
        message: backupEvent.message,
        severity: backupEvent.severity,
        status: backupEvent.status,
        repositoryId: backupEvent.repositoryId,
        workerId: backupEvent.workerId,
        createdAt: backupEvent.createdAt,
      })
      .from(backupEvent)
      .where(
        and(
          eq(backupEvent.userId, user.id),
          gte(backupEvent.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        ),
      )
      .orderBy(desc(backupEvent.createdAt))
      .limit(50);

    const requests24h = syncEvents.reduce((acc, event) => acc + (event.requestsTotal ?? 0), 0);
    const errors24h = syncEvents.reduce((acc, event) => acc + (event.errorTotal ?? 0), 0);

    const onlineWorkers = workers.filter((item) => item.status === "online").length;
    const degradedWorkers = workers.filter((item) => item.status === "degraded").length;
    const offlineWorkers = Math.max(0, workers.length - onlineWorkers - degradedWorkers);

    const traffic = bucketizeSyncEvents(
      [...syncEvents].reverse().map((event) => ({
        createdAt: event.createdAt,
        requestsTotal: Number(event.requestsTotal ?? 0),
        errorTotal: Number(event.errorTotal ?? 0),
      })),
      range,
    );

    return {
      summary: {
        totalWorkers: workers.length,
        onlineWorkers,
        degradedWorkers,
        offlineWorkers,
        requests24h,
        errors24h,
        errorRatePercent:
          requests24h > 0 ? Number(((errors24h / requests24h) * 100).toFixed(2)) : 0,
      },
      incidents: incidents.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
      traffic,
      range,
    };
  })
  .get("/api/observability/events", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 25));
    const offset = Math.max(0, Math.min(50_000, Number(query?.offset) || 0));
    const severity =
      query?.severity === "info" || query?.severity === "warning" || query?.severity === "error"
        ? query.severity
        : "all";
    const statusFilter =
      query?.status === "open" || query?.status === "resolved" ? query.status : "all";

    const whereClauses = [eq(backupEvent.userId, user.id)];
    if (severity !== "all") {
      whereClauses.push(eq(backupEvent.severity, severity));
    }
    if (statusFilter !== "all") {
      whereClauses.push(eq(backupEvent.status, statusFilter));
    }

    const whereExpression = and(...whereClauses);

    const [countRows, eventRows] = await Promise.all([
      db.select({ total: count() }).from(backupEvent).where(whereExpression),
      db
        .select({
          id: backupEvent.id,
          type: backupEvent.type,
          status: backupEvent.status,
          severity: backupEvent.severity,
          message: backupEvent.message,
          repositoryId: backupEvent.repositoryId,
          workerId: backupEvent.workerId,
          planId: backupEvent.planId,
          createdAt: backupEvent.createdAt,
          resolvedAt: backupEvent.resolvedAt,
        })
        .from(backupEvent)
        .where(whereExpression)
        .orderBy(desc(backupEvent.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = Number(countRows[0]?.total ?? 0);

    return {
      events: eventRows.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        resolvedAt: event.resolvedAt ? event.resolvedAt.toISOString() : null,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + eventRows.length < total,
      },
    };
  });
