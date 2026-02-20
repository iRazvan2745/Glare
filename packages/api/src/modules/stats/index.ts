import { db } from "@glare/db";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { backfillBackupMetricsForUser } from "../../shared/backup-metrics";
import { syncUserSnapshots } from "../../shared/snapshot-sync";

export const statsRoutes = new Elysia()
  /**
   * GET /api/stats/traffic?hours=24&buckets=24
   *
   * Returns time-bucketed request and error deltas across all workers
   * owned by the authenticated user.
   *
   * Each bucket contains:
   *  - bucket:     ISO timestamp of the bucket start
   *  - requests:   delta of requestsTotal within that bucket
   *  - errors:     delta of errorTotal within that bucket
   *  - errorRate:  errors / requests * 100 (0 if no requests)
   */
  .get("/api/stats/traffic", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const hoursParam = Number(query?.hours) || 24;
    const hours = Math.max(1, Math.min(168, hoursParam));

    const bucketsParam = Number(query?.buckets) || 24;
    const buckets = Math.max(4, Math.min(96, bucketsParam));

    // Compute bucket width in minutes
    const totalMinutes = hours * 60;
    const bucketMinutes = Math.max(1, Math.floor(totalMinutes / buckets));

    const result = await db.$client.query(
      `
      WITH user_workers AS (
        SELECT "id" FROM "worker" WHERE "user_id" = $1
      ),
      events AS (
        SELECT
          "worker_id",
          "requests_total",
          "error_total",
          "created_at",
          LAG("requests_total") OVER (PARTITION BY "worker_id" ORDER BY "created_at") AS prev_requests,
          LAG("error_total")    OVER (PARTITION BY "worker_id" ORDER BY "created_at") AS prev_errors
        FROM "worker_sync_event"
        WHERE "worker_id" IN (SELECT "id" FROM user_workers)
          AND "created_at" >= NOW() - INTERVAL '1 hour' * $2
        ORDER BY "created_at" ASC
      ),
      deltas AS (
        SELECT
          "created_at",
          GREATEST("requests_total" - COALESCE(prev_requests, "requests_total"), 0) AS req_delta,
          GREATEST("error_total"    - COALESCE(prev_errors,    "error_total"),    0) AS err_delta
        FROM events
      ),
      bucketed AS (
        SELECT
          to_timestamp(
            floor(extract(epoch FROM "created_at") / ($3 * 60)) * ($3 * 60)
          ) AS bucket,
          SUM(req_delta) AS requests,
          SUM(err_delta) AS errors
        FROM deltas
        GROUP BY bucket
        ORDER BY bucket ASC
      )
      SELECT
        bucket,
        requests::int AS requests,
        errors::int   AS errors,
        CASE WHEN requests > 0
          THEN ROUND(errors * 100.0 / requests, 2)
          ELSE 0
        END AS "errorRate"
      FROM bucketed
      `,
      [user.id, hours, bucketMinutes],
    );

    return { buckets: result.rows };
  })

  /**
   * GET /api/stats/snapshot-activity?hours=24&buckets=24
   *
   * Returns time-bucketed backup plan run counts (success / failed)
   * plus individual runs for event markers on the chart.
   */
  .get("/api/stats/snapshot-activity", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    // Fire-and-forget sync so new snapshots appear without waiting
    syncUserSnapshots(user.id).catch(() => undefined);

    const hoursParam = Number(query?.hours) || 24;
    const hours = Math.max(1, Math.min(168, hoursParam));

    const bucketsParam = Number(query?.buckets) || 24;
    const buckets = Math.max(4, Math.min(96, bucketsParam));

    const totalMinutes = hours * 60;
    const bucketMinutes = Math.max(1, Math.floor(totalMinutes / buckets));

    const bucketsResult = await db.$client.query(
      `
      SELECT
        to_timestamp(
          floor(extract(epoch FROM "started_at") / ($2 * 60)) * ($2 * 60)
        ) AS bucket,
        COUNT(*) FILTER (WHERE "status" = 'success')::int AS success,
        COUNT(*) FILTER (WHERE "status" = 'failed')::int  AS failed
      FROM "backup_plan_run"
      WHERE "user_id" = $1
        AND "started_at" >= NOW() - INTERVAL '1 hour' * $3
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [user.id, bucketMinutes, hours],
    );

    const runsResult = await db.$client.query(
      `
      SELECT
        r."id",
        r."plan_id"      AS "planId",
        r."status",
        r."snapshot_id"  AS "snapshotId",
        r."started_at"   AS "startedAt",
        r."finished_at"  AS "finishedAt",
        r."duration_ms"  AS "durationMs",
        r."error",
        p."cron"         AS "planCron"
      FROM "backup_plan_run" r
      LEFT JOIN "backup_plan" p ON p."id" = r."plan_id"
      WHERE r."user_id" = $1
        AND r."started_at" >= NOW() - INTERVAL '1 hour' * $2
      ORDER BY r."started_at" DESC
      LIMIT 200
      `,
      [user.id, hours],
    );

    return {
      buckets: bucketsResult.rows,
      runs: runsResult.rows,
    };
  })

  /**
   * GET /api/stats/storage-usage?hours=24&buckets=24
   *
   * Returns time-bucketed bytes added and cumulative bytes across
   * successful backups for the authenticated user.
   */
  .get("/api/stats/storage-usage", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    // Fire-and-forget sync so new snapshots appear without waiting
    syncUserSnapshots(user.id).catch(() => undefined);

    const hoursParam = Number(query?.hours) || 24;
    const hours = Math.max(1, Math.min(24 * 30, hoursParam));

    const intervalMinutesParam = Number(query?.intervalMinutes);
    const intervalMinutes = Number.isFinite(intervalMinutesParam)
      ? Math.max(1, Math.min(60, Math.floor(intervalMinutesParam)))
      : null;
    const bucketsParam = Number(query?.buckets);
    const defaultBuckets = Math.max(4, Math.min(2_880, Math.floor(hours * 12)));
    const buckets = Number.isFinite(bucketsParam)
      ? Math.max(4, Math.min(2_880, Math.floor(bucketsParam)))
      : defaultBuckets;

    const totalMinutes = hours * 60;
    const bucketMinutes = intervalMinutes ?? Math.max(1, Math.floor(totalMinutes / buckets));

    const result = await db.$client.query(
      `
      WITH run_samples AS (
        SELECT
          r."started_at" AS sample_time,
          GREATEST(
            COALESCE((r."output_json"::json->'parsedJson'->'summary'->>'data_added_packed')::bigint, 0),
            COALESCE((r."output_json"::json->'parsedJson'->'summary'->>'data_added')::bigint, 0),
            COALESCE((r."output_json"::json->'summary'->>'data_added_packed')::bigint, 0),
            COALESCE((r."output_json"::json->'summary'->>'data_added')::bigint, 0)
          ) AS bytes_added,
          COALESCE(
            (r."output_json"::json->'parsedJson'->'summary'->>'total_bytes_processed')::bigint,
            (r."output_json"::json->'summary'->>'total_bytes_processed')::bigint,
            0
          ) AS total_bytes
        FROM "backup_plan_run" r
        WHERE r."user_id" = $1
          AND r."status" = 'success'
          AND r."output_json" IS NOT NULL
          AND r."started_at" >= NOW() - INTERVAL '1 hour' * $3
      ),
      bucketed AS (
        SELECT
          to_timestamp(
            floor(extract(epoch FROM sample_time) / ($2 * 60)) * ($2 * 60)
          ) AS bucket,
          SUM(bytes_added)::bigint AS bytes_added,
          MAX(total_bytes)::bigint AS total_bytes
        FROM run_samples
        WHERE total_bytes > 0 OR bytes_added > 0
        GROUP BY bucket
      )
      SELECT
        bucket,
        bytes_added::text AS "bytesAdded",
        total_bytes::text AS "totalBytes"
      FROM bucketed
      ORDER BY bucket ASC
      `,
      [user.id, bucketMinutes, hours],
    );

    return { buckets: result.rows };
  })

  /**
   * GET /api/stats/size-trends?hours=168&groupBy=plan
   *
   * Returns bytes added and processed over time grouped by plan/repository.
   */
  .get("/api/stats/size-trends", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const hoursParam = Number(query?.hours) || 24 * 7;
    const hours = Math.max(1, Math.min(24 * 90, hoursParam));
    const groupBy = query?.groupBy === "repository" ? "repository" : "plan";

    const result = await db.$client.query(
      `
      SELECT
        date_trunc('hour', m."created_at") AS bucket,
        CASE
          WHEN $3 = 'repository' THEN COALESCE(r."name", m."repository_id")
          ELSE COALESCE(p."name", m."plan_id", 'ad-hoc')
        END AS label,
        SUM(m."bytes_added")::text AS "bytesAdded",
        SUM(m."bytes_processed")::text AS "bytesProcessed"
      FROM "backup_run_metric" m
      LEFT JOIN "backup_plan" p ON p."id" = m."plan_id"
      LEFT JOIN "rustic_repository" r ON r."id" = m."repository_id"
      WHERE m."user_id" = $1
        AND m."created_at" >= NOW() - INTERVAL '1 hour' * $2
      GROUP BY bucket, label
      ORDER BY bucket ASC
      `,
      [user.id, hours, groupBy],
    );

    return {
      groupBy,
      points: result.rows,
    };
  })

  /**
   * GET /api/stats/dedup?hours=168&groupBy=plan
   *
   * Returns dedup/savings ratio grouped by plan or repository.
   */
  .get("/api/stats/dedup", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const hoursParam = Number(query?.hours) || 24 * 7;
    const hours = Math.max(1, Math.min(24 * 90, hoursParam));
    const groupBy = query?.groupBy === "repository" ? "repository" : "plan";
    await backfillBackupMetricsForUser({ userId: user.id, hours });

    const result = await db.$client.query(
      `
      SELECT
        CASE
          WHEN $3 = 'repository' THEN COALESCE(r."name", m."repository_id")
          ELSE COALESCE(p."name", m."plan_id", 'ad-hoc')
        END AS label,
        SUM(m."bytes_added")::bigint AS bytes_added,
        SUM(m."bytes_processed")::bigint AS bytes_processed
      FROM "backup_run_metric" m
      LEFT JOIN "backup_plan" p ON p."id" = m."plan_id"
      LEFT JOIN "rustic_repository" r ON r."id" = m."repository_id"
      WHERE m."user_id" = $1
        AND m."created_at" >= NOW() - INTERVAL '1 hour' * $2
      GROUP BY label
      ORDER BY label ASC
      `,
      [user.id, hours, groupBy],
    );

    const rows = (
      result.rows as Array<{ label: string; bytes_added: string; bytes_processed: string }>
    ).map((row) => {
      const bytesAdded = Number(row.bytes_added);
      const bytesProcessed = Number(row.bytes_processed);
      const savedBytes = Math.max(0, bytesProcessed - bytesAdded);
      const savingsPercent =
        bytesProcessed > 0 ? Number(((savedBytes / bytesProcessed) * 100).toFixed(2)) : 0;
      return {
        label: row.label,
        bytesAdded,
        bytesProcessed,
        savedBytes,
        savingsPercent,
      };
    });

    return {
      groupBy,
      rows,
    };
  })

  /**
   * GET /api/stats/anomalies?hours=168&status=open
   */
  .get("/api/stats/anomalies", async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const hoursParam = Number(query?.hours) || 24 * 7;
    const hours = Math.max(1, Math.min(24 * 180, hoursParam));
    const statusFilter =
      query?.status === "resolved" ? "resolved" : query?.status === "all" ? "all" : "open";
    await backfillBackupMetricsForUser({ userId: user.id, hours });

    const result = await db.$client.query(
      `
      SELECT
        a."id",
        a."status",
        a."severity",
        a."reason",
        a."deviation_score"::text AS "score",
        a."expected_bytes"::text AS "expectedBytes",
        a."actual_bytes"::text AS "actualBytes",
        a."detected_at" AS "detectedAt",
        a."resolved_at" AS "resolvedAt",
        p."name" AS "planName",
        r."name" AS "repositoryName"
      FROM "backup_size_anomaly" a
      LEFT JOIN "backup_plan" p ON p."id" = a."plan_id"
      LEFT JOIN "rustic_repository" r ON r."id" = a."repository_id"
      WHERE a."user_id" = $1
        AND a."detected_at" >= NOW() - INTERVAL '1 hour' * $2
        AND ($3 = 'all' OR a."status" = $3)
      ORDER BY a."detected_at" DESC
      LIMIT 500
      `,
      [user.id, hours, statusFilter],
    );

    return {
      rows: result.rows,
    };
  });
