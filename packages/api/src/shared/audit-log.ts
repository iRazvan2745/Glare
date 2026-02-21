import { db } from "@glare/db";
import { auditLog } from "@glare/db/schema/audit-logs";

import { logWarn } from "./logger";

export async function writeAuditLog(input: {
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  request?: Request;
}) {
  try {
    const forwardedFor = input.request?.headers.get("x-forwarded-for") ?? null;
    const ipAddress = forwardedFor?.split(",")[0]?.trim() || null;
    const userAgent = input.request?.headers.get("user-agent") ?? null;

    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      ipAddress,
      userAgent,
      createdAt: new Date(),
    });
  } catch (error) {
    logWarn("audit log write failed", {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
