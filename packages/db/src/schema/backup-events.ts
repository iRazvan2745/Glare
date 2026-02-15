import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { backupPlan } from "./backup-plans";
import { backupPlanRun } from "./backup-plan-runs";
import { rusticRepository } from "./repositories";
import { worker } from "./workers";

export const backupEvent = pgTable(
  "backup_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => backupPlan.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => backupPlanRun.id, { onDelete: "set null" }),
    workerId: text("worker_id").references(() => worker.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    status: text("status").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    detailsJson: text("details_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("backup_event_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("backup_event_repositoryId_createdAt_idx").on(table.repositoryId, table.createdAt),
    index("backup_event_planId_createdAt_idx").on(table.planId, table.createdAt),
    index("backup_event_status_createdAt_idx").on(table.status, table.createdAt),
  ],
);

export const backupEventRelations = relations(backupEvent, ({ one }) => ({
  user: one(user, {
    fields: [backupEvent.userId],
    references: [user.id],
  }),
  repository: one(rusticRepository, {
    fields: [backupEvent.repositoryId],
    references: [rusticRepository.id],
  }),
  plan: one(backupPlan, {
    fields: [backupEvent.planId],
    references: [backupPlan.id],
  }),
  run: one(backupPlanRun, {
    fields: [backupEvent.runId],
    references: [backupPlanRun.id],
  }),
  worker: one(worker, {
    fields: [backupEvent.workerId],
    references: [worker.id],
  }),
}));
