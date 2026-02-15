import { db } from "@glare/db";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";

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
  });
