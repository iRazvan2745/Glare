import { relations } from "drizzle-orm";
import { bigint, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { backupPlan } from "./backup-plans";
import { backupRunMetric } from "./backup-run-metrics";
import { rusticRepository } from "./repositories";

export const backupSizeAnomaly = pgTable(
  "backup_size_anomaly",
  {
    id: text("id").primaryKey(),
    metricId: text("metric_id")
      .notNull()
      .references(() => backupRunMetric.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => backupPlan.id, { onDelete: "set null" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    expectedBytes: bigint("expected_bytes", { mode: "number" }).notNull(),
    actualBytes: bigint("actual_bytes", { mode: "number" }).notNull(),
    deviationScore: numeric("deviation_score", { precision: 8, scale: 3 }).notNull(),
    status: text("status").default("open").notNull(),
    severity: text("severity").default("warning").notNull(),
    reason: text("reason").notNull(),
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => [
    index("backup_size_anomaly_userId_detectedAt_idx").on(table.userId, table.detectedAt),
    index("backup_size_anomaly_planId_detectedAt_idx").on(table.planId, table.detectedAt),
    index("backup_size_anomaly_repositoryId_detectedAt_idx").on(
      table.repositoryId,
      table.detectedAt,
    ),
    index("backup_size_anomaly_status_detectedAt_idx").on(table.status, table.detectedAt),
  ],
);

export const backupSizeAnomalyRelations = relations(backupSizeAnomaly, ({ one }) => ({
  metric: one(backupRunMetric, {
    fields: [backupSizeAnomaly.metricId],
    references: [backupRunMetric.id],
  }),
  user: one(user, {
    fields: [backupSizeAnomaly.userId],
    references: [user.id],
  }),
  plan: one(backupPlan, {
    fields: [backupSizeAnomaly.planId],
    references: [backupPlan.id],
  }),
  repository: one(rusticRepository, {
    fields: [backupSizeAnomaly.repositoryId],
    references: [rusticRepository.id],
  }),
}));
