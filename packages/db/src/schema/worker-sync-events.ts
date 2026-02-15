import { relations } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { worker } from "./workers";

export const workerSyncEvent = pgTable(
  "worker_sync_event",
  {
    id: text("id").primaryKey(),
    workerId: text("worker_id")
      .notNull()
      .references(() => worker.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    uptimeMs: bigint("uptime_ms", { mode: "number" }).notNull(),
    requestsTotal: bigint("requests_total", { mode: "number" }).notNull(),
    errorTotal: bigint("error_total", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("worker_sync_event_worker_created_idx").on(table.workerId, table.createdAt),
    index("worker_sync_event_created_idx").on(table.createdAt),
  ],
);

export const workerSyncEventRelations = relations(workerSyncEvent, ({ one }) => ({
  worker: one(worker, {
    fields: [workerSyncEvent.workerId],
    references: [worker.id],
  }),
}));
