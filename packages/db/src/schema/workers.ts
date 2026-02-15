import { relations } from "drizzle-orm";
import { bigint, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { workerSyncEvent } from "./worker-sync-events";

export const worker = pgTable(
  "worker",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    syncTokenHash: text("sync_token_hash"),
    syncToken: text("sync_token"),
    endpoint: text("endpoint"),
    status: text("status").default("offline").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    uptimeMs: bigint("uptime_ms", { mode: "number" }).default(0).notNull(),
    requestsTotal: bigint("requests_total", { mode: "number" }).default(0).notNull(),
    errorTotal: bigint("error_total", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("worker_userId_idx").on(table.userId)],
);

export const workerRelations = relations(worker, ({ one, many }) => ({
  user: one(user, {
    fields: [worker.userId],
    references: [user.id],
  }),
  syncEvents: many(workerSyncEvent),
}));
