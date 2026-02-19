import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadataJson: text("metadata_json"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_actorUserId_createdAt_idx").on(table.actorUserId, table.createdAt),
    index("audit_log_action_createdAt_idx").on(table.action, table.createdAt),
    index("audit_log_resourceType_resourceId_createdAt_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
  ],
);
