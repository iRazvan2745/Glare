import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { backupPlan } from "./backup-plans";
import { worker } from "./workers";

export const backupPlanWorker = pgTable(
  "backup_plan_worker",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => backupPlan.id, { onDelete: "cascade" }),
    workerId: text("worker_id")
      .notNull()
      .references(() => worker.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("backup_plan_worker_unique_idx").on(table.planId, table.workerId),
    index("backup_plan_worker_workerId_idx").on(table.workerId),
  ],
);

export const backupPlanWorkerRelations = relations(backupPlanWorker, ({ one }) => ({
  plan: one(backupPlan, {
    fields: [backupPlanWorker.planId],
    references: [backupPlan.id],
  }),
  worker: one(worker, {
    fields: [backupPlanWorker.workerId],
    references: [worker.id],
  }),
}));
