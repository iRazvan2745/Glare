import { relations } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { backupPlan } from "./backup-plans";
import { backupPlanRun } from "./backup-plan-runs";
import { rusticRepository } from "./repositories";
import { worker } from "./workers";

export const backupRunMetric = pgTable(
  "backup_run_metric",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backupPlanRun.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => backupPlan.id, { onDelete: "set null" }),
    workerId: text("worker_id").references(() => worker.id, { onDelete: "set null" }),
    snapshotId: text("snapshot_id"),
    snapshotTime: timestamp("snapshot_time"),
    bytesAdded: bigint("bytes_added", { mode: "number" }).notNull(),
    bytesProcessed: bigint("bytes_processed", { mode: "number" }).notNull(),
    filesNew: integer("files_new"),
    filesChanged: integer("files_changed"),
    filesUnmodified: integer("files_unmodified"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("backup_run_metric_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("backup_run_metric_planId_createdAt_idx").on(table.planId, table.createdAt),
    index("backup_run_metric_repositoryId_createdAt_idx").on(table.repositoryId, table.createdAt),
    index("backup_run_metric_runId_idx").on(table.runId),
  ],
);

export const backupRunMetricRelations = relations(backupRunMetric, ({ one }) => ({
  run: one(backupPlanRun, {
    fields: [backupRunMetric.runId],
    references: [backupPlanRun.id],
  }),
  user: one(user, {
    fields: [backupRunMetric.userId],
    references: [user.id],
  }),
  repository: one(rusticRepository, {
    fields: [backupRunMetric.repositoryId],
    references: [rusticRepository.id],
  }),
  plan: one(backupPlan, {
    fields: [backupRunMetric.planId],
    references: [backupPlan.id],
  }),
  worker: one(worker, {
    fields: [backupRunMetric.workerId],
    references: [worker.id],
  }),
}));
