import { db } from "@glare/db";
import { Elysia } from "elysia";

import { getAuthenticatedUser } from "../../shared/auth/session";

function toCsvLine(fields: Array<string | number | null>) {
  return fields
    .map((field) => {
      const value = field == null ? "" : String(field);
      if (value.includes(",") || value.includes("\n") || value.includes('"')) {
        return `"${value.replaceAll('"', '""')}"`;
      }
      return value;
    })
    .join(",");
}

export const complianceRoutes = new Elysia({ prefix: "/api" }).get(
  "/compliance/report.csv",
  async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) return status(401, { error: "Unauthorized" });

    const hoursParam = Number(query?.hours) || 24 * 7;
    const hours = Math.max(1, Math.min(24 * 365, hoursParam));

    const rows = await db.$client.query(
      `
      WITH run_stats AS (
        SELECT
          "plan_id",
          COUNT(*)::int AS total_runs,
          COUNT(*) FILTER (WHERE "status" = 'success')::int AS success_runs,
          COUNT(*) FILTER (WHERE "status" = 'failed')::int AS failed_runs,
          MAX("started_at") FILTER (WHERE "status" = 'success') AS last_success_at
        FROM "backup_plan_run"
        WHERE "user_id" = $1
          AND "started_at" >= NOW() - INTERVAL '1 hour' * $2
        GROUP BY "plan_id"
      )
      SELECT
        p."id" AS "planId",
        p."name" AS "planName",
        r."name" AS "repositoryName",
        p."enabled" AS "enabled",
        p."cron" AS "cron",
        COALESCE(s.total_runs, 0) AS "totalRuns",
        COALESCE(s.success_runs, 0) AS "successRuns",
        COALESCE(s.failed_runs, 0) AS "failedRuns",
        s.last_success_at AS "lastSuccessAt",
        p."last_status" AS "lastStatus",
        p."last_error" AS "lastError"
      FROM "backup_plan" p
      LEFT JOIN run_stats s ON s."plan_id" = p."id"
      LEFT JOIN "rustic_repository" r ON r."id" = p."repository_id"
      WHERE p."user_id" = $1
      ORDER BY p."name" ASC
      `,
      [user.id, hours],
    );

    const header = [
      "plan_id",
      "plan_name",
      "repository",
      "enabled",
      "cron",
      "total_runs",
      "success_runs",
      "failed_runs",
      "success_rate_percent",
      "last_success_at",
      "last_status",
      "last_error",
    ];
    const lines = [toCsvLine(header)];

    for (const row of rows.rows as Array<{
      planId: string;
      planName: string;
      repositoryName: string | null;
      enabled: boolean;
      cron: string;
      totalRuns: number;
      successRuns: number;
      failedRuns: number;
      lastSuccessAt: string | null;
      lastStatus: string | null;
      lastError: string | null;
    }>) {
      const successRate =
        row.totalRuns > 0 ? Number(((row.successRuns / row.totalRuns) * 100).toFixed(2)) : 0;
      lines.push(
        toCsvLine([
          row.planId,
          row.planName,
          row.repositoryName,
          row.enabled ? "true" : "false",
          row.cron,
          row.totalRuns,
          row.successRuns,
          row.failedRuns,
          successRate,
          row.lastSuccessAt,
          row.lastStatus,
          row.lastError,
        ]),
      );
    }

    return new Response(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"backup-compliance-${new Date().toISOString().slice(0, 10)}.csv\"`,
      },
    });
  },
);
