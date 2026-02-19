import { relations } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { backupPlanRun } from "./backup-plan-runs";
import { rusticRepository } from "./repositories";

export const storageUsageEvent = pgTable(
  "storage_usage_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => backupPlanRun.id, { onDelete: "set null" }),
    bytesAdded: bigint("bytes_added", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("storage_usage_event_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("storage_usage_event_repositoryId_createdAt_idx").on(table.repositoryId, table.createdAt),
    index("storage_usage_event_runId_idx").on(table.runId),
  ],
);

export const storageUsageEventRelations = relations(storageUsageEvent, ({ one }) => ({
  user: one(user, {
    fields: [storageUsageEvent.userId],
    references: [user.id],
  }),
  repository: one(rusticRepository, {
    fields: [storageUsageEvent.repositoryId],
    references: [rusticRepository.id],
  }),
  run: one(backupPlanRun, {
    fields: [storageUsageEvent.runId],
    references: [backupPlanRun.id],
  }),
}));
