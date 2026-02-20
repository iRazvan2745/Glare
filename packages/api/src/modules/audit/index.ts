import { db } from "@glare/db";
import { auditLog } from "@glare/db/schema/audit-logs";
import { and, desc, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import { getAuthenticatedUser } from "../../shared/auth/session";

function parseMetadata(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

export const auditRoutes = new Elysia({ prefix: "/api" }).get(
  "/audit/logs",
  async ({ request, query, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) return status(401, { error: "Unauthorized" });

    const limit = Math.max(1, Math.min(200, Number(query?.limit) || 50));
    const actionFilter = typeof query?.action === "string" ? query.action : "all";
    const resourceTypeFilter = typeof query?.resourceType === "string" ? query.resourceType : "all";

    const conditions = [eq(auditLog.actorUserId, user.id)];
    if (actionFilter !== "all") conditions.push(eq(auditLog.action, actionFilter));
    if (resourceTypeFilter !== "all")
      conditions.push(eq(auditLog.resourceType, resourceTypeFilter));

    const rows = await db.query.auditLog.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        metadataJson: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
      orderBy: [desc(auditLog.createdAt)],
      limit,
    });

    return {
      logs: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: parseMetadata(row.metadataJson),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },
);
