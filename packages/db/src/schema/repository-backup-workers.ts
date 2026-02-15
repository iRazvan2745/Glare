import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { rusticRepository } from "./repositories";
import { worker } from "./workers";

export const rusticRepositoryBackupWorker = pgTable(
  "rustic_repository_backup_worker",
  {
    repositoryId: text("repository_id")
      .notNull()
      .references(() => rusticRepository.id, { onDelete: "cascade" }),
    workerId: text("worker_id")
      .notNull()
      .references(() => worker.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rustic_repository_backup_worker_unique_idx").on(table.repositoryId, table.workerId),
    index("rustic_repository_backup_worker_workerId_idx").on(table.workerId),
  ],
);

export const rusticRepositoryBackupWorkerRelations = relations(
  rusticRepositoryBackupWorker,
  ({ one }) => ({
    repository: one(rusticRepository, {
      fields: [rusticRepositoryBackupWorker.repositoryId],
      references: [rusticRepository.id],
    }),
    worker: one(worker, {
      fields: [rusticRepositoryBackupWorker.workerId],
      references: [worker.id],
    }),
  }),
);
