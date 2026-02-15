import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { rusticRepository } from "./repositories";
import { worker } from "./workers";

export const backupPlan = pgTable(
  "backup_plan",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    workerId: text("worker_id")
      .notNull()
      .references(() => worker.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cron: text("cron").notNull(),
    pathsJson: text("paths_json").notNull(),
    tagsJson: text("tags_json"),
    dryRun: boolean("dry_run").default(false).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    lastDurationMs: integer("last_duration_ms"),
    pruneEnabled: boolean("prune_enabled").default(false).notNull(),
    keepLast: integer("keep_last"),
    keepDaily: integer("keep_daily"),
    keepWeekly: integer("keep_weekly"),
    keepMonthly: integer("keep_monthly"),
    keepYearly: integer("keep_yearly"),
    keepWithin: text("keep_within"),
    runLeaseUntil: timestamp("run_lease_until"),
    runLeaseOwner: text("run_lease_owner"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("backup_plan_userId_idx").on(table.userId),
    index("backup_plan_repositoryId_idx").on(table.repositoryId),
    index("backup_plan_workerId_idx").on(table.workerId),
    index("backup_plan_enabled_nextRunAt_idx").on(table.enabled, table.nextRunAt),
  ],
);

export const backupPlanRelations = relations(backupPlan, ({ one }) => ({
  user: one(user, {
    fields: [backupPlan.userId],
    references: [user.id],
  }),
  repository: one(rusticRepository, {
    fields: [backupPlan.repositoryId],
    references: [rusticRepository.id],
  }),
  worker: one(worker, {
    fields: [backupPlan.workerId],
    references: [worker.id],
  }),
}));
