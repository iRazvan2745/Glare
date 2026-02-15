import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { backupPlan } from "./backup-plans";
import { rusticRepository } from "./repositories";
import { user } from "./auth";
import { worker } from "./workers";

export const backupPlanRun = pgTable(
  "backup_plan_run",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => backupPlan.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    workerId: text("worker_id").references(() => worker.id, { onDelete: "set null" }),
    runGroupId: text("run_group_id"),
    type: text("type").default("backup").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    snapshotId: text("snapshot_id"),
    snapshotTime: timestamp("snapshot_time"),
    outputJson: text("output_json"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("backup_plan_run_planId_startedAt_idx").on(table.planId, table.startedAt),
    index("backup_plan_run_userId_startedAt_idx").on(table.userId, table.startedAt),
    index("backup_plan_run_runGroupId_startedAt_idx").on(table.runGroupId, table.startedAt),
  ],
);

export const backupPlanRunRelations = relations(backupPlanRun, ({ one }) => ({
  plan: one(backupPlan, {
    fields: [backupPlanRun.planId],
    references: [backupPlan.id],
  }),
  user: one(user, {
    fields: [backupPlanRun.userId],
    references: [user.id],
  }),
  repository: one(rusticRepository, {
    fields: [backupPlanRun.repositoryId],
    references: [rusticRepository.id],
  }),
  worker: one(worker, {
    fields: [backupPlanRun.workerId],
    references: [worker.id],
  }),
}));
