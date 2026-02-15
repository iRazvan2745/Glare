import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { worker } from "./workers";

export const rusticRepository = pgTable(
  "rustic_repository",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workerId: text("worker_id").references(() => worker.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    backend: text("backend").notNull(),
    repository: text("repository").notNull(),
    password: text("password"),
    optionsJson: text("options_json"),
    initializedAt: timestamp("initialized_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("rustic_repository_userId_idx").on(table.userId),
    index("rustic_repository_workerId_idx").on(table.workerId),
  ],
);

export const rusticRepositoryRelations = relations(rusticRepository, ({ one }) => ({
  user: one(user, {
    fields: [rusticRepository.userId],
    references: [user.id],
  }),
  worker: one(worker, {
    fields: [rusticRepository.workerId],
    references: [worker.id],
  }),
}));
