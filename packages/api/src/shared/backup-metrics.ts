import { db } from "@glare/db";
import { backupRunMetric } from "@glare/db/schema/backup-run-metrics";
import { backupSizeAnomaly } from "@glare/db/schema/backup-size-anomalies";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

import { logWarn } from "./logger";

type BackupMetricInput = {
  runId: string;
  userId: string;
  repositoryId: string;
  planId?: string | null;
  workerId?: string | null;
  snapshotId?: string | null;
  snapshotTime?: Date | null;
  output: unknown;
};

type ParsedBackupMetric = {
  bytesAdded: number;
  bytesProcessed: number;
  filesNew: number | null;
  filesChanged: number | null;
  filesUnmodified: number | null;
};

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function findFirstMetricFromSummary(root: unknown, keys: readonly string[]) {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    const summary = record.summary;
    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
      const summaryRecord = summary as Record<string, unknown>;
      for (const key of keys) {
        const value = parseNumber(summaryRecord[key]);
        if (value !== null) return value;
      }
    }

    queue.push(...Object.values(record));
  }
  return null;
}

function findFirstMetricAnywhere(root: unknown, keys: readonly string[]) {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of keys) {
      const value = parseNumber(record[key]);
      if (value !== null) return value;
    }
    queue.push(...Object.values(record));
  }
  return null;
}

function parseBackupMetric(output: unknown): ParsedBackupMetric | null {
  const bytesAdded =
    findFirstMetricFromSummary(output, ["data_added", "dataAdded", "bytes_added", "bytesAdded"]) ??
    findFirstMetricAnywhere(output, ["data_added", "dataAdded", "bytes_added", "bytesAdded"]);

  const bytesProcessed =
    findFirstMetricFromSummary(output, [
      "total_bytes_processed",
      "totalBytesProcessed",
      "bytes_processed",
      "bytesProcessed",
    ]) ??
    findFirstMetricAnywhere(output, [
      "total_bytes_processed",
      "totalBytesProcessed",
      "bytes_processed",
      "bytesProcessed",
    ]);

  if (bytesAdded === null && bytesProcessed === null) {
    return null;
  }

  const filesNew = findFirstMetricFromSummary(output, ["files_new", "filesNew"]);
  const filesChanged = findFirstMetricFromSummary(output, ["files_changed", "filesChanged"]);
  const filesUnmodified = findFirstMetricFromSummary(output, [
    "files_unmodified",
    "filesUnmodified",
  ]);

  return {
    bytesAdded: Math.max(0, Math.trunc(bytesAdded ?? 0)),
    bytesProcessed: Math.max(0, Math.floor(bytesProcessed ?? Math.max(0, bytesAdded ?? 0))),
    filesNew: filesNew === null ? null : Math.max(0, Math.floor(filesNew)),
    filesChanged: filesChanged === null ? null : Math.max(0, Math.floor(filesChanged)),
    filesUnmodified: filesUnmodified === null ? null : Math.max(0, Math.floor(filesUnmodified)),
  };
}

export async function recordBackupMetric(input: BackupMetricInput) {
  const parsed = parseBackupMetric(input.output);
  if (!parsed) return null;

  const metricId = crypto.randomUUID();
  try {
    await db.insert(backupRunMetric).values({
      id: metricId,
      runId: input.runId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      planId: input.planId ?? null,
      workerId: input.workerId ?? null,
      snapshotId: input.snapshotId ?? null,
      snapshotTime: input.snapshotTime ?? null,
      bytesAdded: parsed.bytesAdded,
      bytesProcessed: parsed.bytesProcessed,
      filesNew: parsed.filesNew,
      filesChanged: parsed.filesChanged,
      filesUnmodified: parsed.filesUnmodified,
      createdAt: new Date(),
    });
  } catch (error) {
    logWarn("backup metric write failed", {
      runId: input.runId,
      userId: input.userId,
      repositoryId: input.repositoryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return { id: metricId, ...parsed };
}

export async function backfillBackupMetricsForUser(input: {
  userId: string;
  hours: number;
  limit?: number;
}) {
  const hours = Math.max(1, Math.min(24 * 180, Math.floor(input.hours)));
  const limit = Math.max(1, Math.min(1000, input.limit ?? 300));
  let remainingCapacity = limit;

  const missingRuns = await db.$client.query(
    `
    SELECT
      r."id" AS run_id,
      r."user_id" AS user_id,
      r."repository_id" AS repository_id,
      r."plan_id" AS plan_id,
      r."worker_id" AS worker_id,
      r."snapshot_id" AS snapshot_id,
      r."snapshot_time" AS snapshot_time,
      r."output_json" AS output_json
    FROM "backup_plan_run" r
    LEFT JOIN "backup_run_metric" m ON m."run_id" = r."id"
    WHERE r."user_id" = $1
      AND r."status" = 'success'
      AND r."output_json" IS NOT NULL
      AND r."finished_at" >= NOW() - INTERVAL '1 hour' * $2
      AND m."id" IS NULL
    ORDER BY r."finished_at" ASC
    LIMIT $3
    `,
    [input.userId, hours, Math.max(0, remainingCapacity)],
  );

  let inserted = 0;
  for (const run of missingRuns.rows as Array<{
    run_id: string;
    user_id: string;
    repository_id: string;
    plan_id: string | null;
    worker_id: string | null;
    snapshot_id: string | null;
    snapshot_time: string | Date | null;
    output_json: string | null;
  }>) {
    if (!run.output_json) continue;

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(run.output_json);
    } catch {
      continue;
    }

    const metric = await recordBackupMetric({
      runId: run.run_id,
      userId: run.user_id,
      repositoryId: run.repository_id,
      planId: run.plan_id,
      workerId: run.worker_id,
      snapshotId: run.snapshot_id,
      snapshotTime: run.snapshot_time ? new Date(run.snapshot_time) : null,
      output: parsedOutput,
    });
    if (!metric) continue;

    inserted += 1;
    remainingCapacity -= 1;
    await detectBackupSizeAnomaly({
      metricId: metric.id,
      userId: run.user_id,
      planId: run.plan_id,
      repositoryId: run.repository_id,
      actualBytes: metric.bytesAdded,
    });
  }

  const missingFromStorageEvents = await db.$client.query(
    `
    SELECT
      s."run_id" AS run_id,
      s."user_id" AS user_id,
      s."repository_id" AS repository_id,
      s."bytes_added" AS bytes_added,
      s."created_at" AS created_at,
      r."plan_id" AS plan_id,
      r."worker_id" AS worker_id,
      r."snapshot_id" AS snapshot_id,
      r."snapshot_time" AS snapshot_time
    FROM "storage_usage_event" s
    LEFT JOIN "backup_run_metric" m ON m."run_id" = s."run_id"
    LEFT JOIN "backup_plan_run" r ON r."id" = s."run_id"
    WHERE s."user_id" = $1
      AND s."run_id" IS NOT NULL
      AND s."created_at" >= NOW() - INTERVAL '1 hour' * $2
      AND m."id" IS NULL
    ORDER BY s."created_at" ASC
    LIMIT $3
    `,
    [input.userId, hours, Math.max(0, remainingCapacity)],
  );

  for (const row of missingFromStorageEvents.rows as Array<{
    run_id: string | null;
    user_id: string;
    repository_id: string;
    bytes_added: string | number;
    created_at: string | Date;
    plan_id: string | null;
    worker_id: string | null;
    snapshot_id: string | null;
    snapshot_time: string | Date | null;
  }>) {
    if (!row.run_id) continue;
    const bytesAdded = Number(row.bytes_added);
    if (!Number.isFinite(bytesAdded) || bytesAdded <= 0) continue;
    const normalizedBytesAdded = Math.trunc(bytesAdded);
    const bytesProcessed = normalizedBytesAdded;

    const metricId = crypto.randomUUID();
    try {
      await db.insert(backupRunMetric).values({
        id: metricId,
        runId: row.run_id,
        userId: row.user_id,
        repositoryId: row.repository_id,
        planId: row.plan_id,
        workerId: row.worker_id,
        snapshotId: row.snapshot_id,
        snapshotTime: row.snapshot_time ? new Date(row.snapshot_time) : null,
        bytesAdded: normalizedBytesAdded,
        bytesProcessed,
        filesNew: null,
        filesChanged: null,
        filesUnmodified: null,
        createdAt: new Date(row.created_at),
      });
    } catch {
      continue;
    }

    inserted += 1;
    remainingCapacity -= 1;
    await detectBackupSizeAnomaly({
      metricId,
      userId: row.user_id,
      planId: row.plan_id,
      repositoryId: row.repository_id,
      actualBytes: normalizedBytesAdded,
    });
  }

  return { inserted };
}

export async function detectBackupSizeAnomaly(input: {
  metricId: string;
  userId: string;
  planId?: string | null;
  repositoryId: string;
  actualBytes: number;
}) {
  const historical = await db
    .select({
      bytesAdded: backupRunMetric.bytesAdded,
    })
    .from(backupRunMetric)
    .where(
      input.planId
        ? and(
            eq(backupRunMetric.userId, input.userId),
            eq(backupRunMetric.planId, input.planId),
            ne(backupRunMetric.id, input.metricId),
          )
        : and(
            eq(backupRunMetric.userId, input.userId),
            eq(backupRunMetric.repositoryId, input.repositoryId),
            ne(backupRunMetric.id, input.metricId),
          ),
    )
    .orderBy(desc(backupRunMetric.createdAt))
    .limit(30);

  const series = historical
    .map((item) => Number(item.bytesAdded))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (series.length < 5) {
    return null;
  }

  const median = series[Math.floor(series.length / 2)] ?? 0;
  const deviations = series.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] ?? 0;
  const safeMad = Math.max(1, mad);
  const score = Math.abs(input.actualBytes - median) / safeMad;

  if (score < 3.5) {
    await db
      .update(backupSizeAnomaly)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(
        and(
          eq(backupSizeAnomaly.userId, input.userId),
          input.planId != null
            ? eq(backupSizeAnomaly.planId, input.planId)
            : isNull(backupSizeAnomaly.planId),
          eq(backupSizeAnomaly.repositoryId, input.repositoryId),
          isNull(backupSizeAnomaly.resolvedAt),
        ),
      )
      .catch((error) => {
        logWarn("failed to resolve backup size anomaly", {
          userId: input.userId,
          planId: input.planId,
          repositoryId: input.repositoryId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return null;
  }

  const anomalyId = crypto.randomUUID();
  const reason = input.actualBytes > median ? "larger_than_expected" : "smaller_than_expected";
  const inserted = await db.insert(backupSizeAnomaly).values({
    id: anomalyId,
    metricId: input.metricId,
    userId: input.userId,
    planId: input.planId ?? null,
    repositoryId: input.repositoryId,
    expectedBytes: Math.floor(median),
    actualBytes: Math.floor(input.actualBytes),
    deviationScore: score.toFixed(3),
    status: "open",
    severity: score >= 6 ? "error" : "warning",
    reason,
    detectedAt: new Date(),
    resolvedAt: null,
  }).catch((error) => {
    logWarn("failed to insert backup size anomaly", {
      anomalyId,
      metricId: input.metricId,
      userId: input.userId,
      planId: input.planId,
      repositoryId: input.repositoryId,
      actualBytes: input.actualBytes,
      expectedBytes: Math.floor(median),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!inserted) {
    return null;
  }

  return {
    id: anomalyId,
    severity: score >= 6 ? "error" : "warning",
    score: Number(score.toFixed(3)),
    expectedBytes: Math.floor(median),
    reason,
  };
}
