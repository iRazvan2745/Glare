CREATE TABLE "rustic_repository_backup_worker" (
  "repository_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "rustic_repository_backup_worker"
  ADD CONSTRAINT "rustic_repository_backup_worker_repository_id_rustic_repository_id_fk"
  FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "rustic_repository_backup_worker"
  ADD CONSTRAINT "rustic_repository_backup_worker_worker_id_worker_id_fk"
  FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "rustic_repository_backup_worker_unique_idx"
  ON "rustic_repository_backup_worker" USING btree ("repository_id", "worker_id");

CREATE INDEX "rustic_repository_backup_worker_workerId_idx"
  ON "rustic_repository_backup_worker" USING btree ("worker_id");

CREATE TABLE "backup_event" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "repository_id" text NOT NULL,
  "plan_id" text,
  "run_id" text,
  "worker_id" text,
  "type" text NOT NULL,
  "status" text NOT NULL,
  "severity" text NOT NULL,
  "message" text NOT NULL,
  "details_json" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp
);

ALTER TABLE "backup_event"
  ADD CONSTRAINT "backup_event_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "backup_event"
  ADD CONSTRAINT "backup_event_repository_id_rustic_repository_id_fk"
  FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "backup_event"
  ADD CONSTRAINT "backup_event_plan_id_backup_plan_id_fk"
  FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "backup_event"
  ADD CONSTRAINT "backup_event_run_id_backup_plan_run_id_fk"
  FOREIGN KEY ("run_id") REFERENCES "public"."backup_plan_run"("id")
  ON DELETE set null ON UPDATE no action;

ALTER TABLE "backup_event"
  ADD CONSTRAINT "backup_event_worker_id_worker_id_fk"
  FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "backup_event_userId_createdAt_idx"
  ON "backup_event" USING btree ("user_id", "created_at");
CREATE INDEX "backup_event_repositoryId_createdAt_idx"
  ON "backup_event" USING btree ("repository_id", "created_at");
CREATE INDEX "backup_event_planId_createdAt_idx"
  ON "backup_event" USING btree ("plan_id", "created_at");
CREATE INDEX "backup_event_status_createdAt_idx"
  ON "backup_event" USING btree ("status", "created_at");

ALTER TABLE "backup_plan_run" ADD COLUMN "run_group_id" text;
CREATE INDEX "backup_plan_run_runGroupId_startedAt_idx"
  ON "backup_plan_run" USING btree ("run_group_id", "started_at");

INSERT INTO "rustic_repository_backup_worker" ("repository_id", "worker_id")
SELECT "id", "worker_id"
FROM "rustic_repository"
WHERE "worker_id" IS NOT NULL
ON CONFLICT ("repository_id", "worker_id") DO NOTHING;
