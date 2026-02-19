CREATE TABLE "storage_usage_event" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "repository_id" text NOT NULL,
  "run_id" text,
  "bytes_added" bigint NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_usage_event"
  ADD CONSTRAINT "storage_usage_event_user_id_user_id_fk"
  FOREIGN KEY ("user_id")
  REFERENCES "public"."user"("id")
  ON DELETE cascade
  ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_usage_event"
  ADD CONSTRAINT "storage_usage_event_repository_id_rustic_repository_id_fk"
  FOREIGN KEY ("repository_id")
  REFERENCES "public"."rustic_repository"("id")
  ON DELETE cascade
  ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "storage_usage_event"
  ADD CONSTRAINT "storage_usage_event_run_id_backup_plan_run_id_fk"
  FOREIGN KEY ("run_id")
  REFERENCES "public"."backup_plan_run"("id")
  ON DELETE set null
  ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "storage_usage_event_userId_createdAt_idx" ON "storage_usage_event" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "storage_usage_event_repositoryId_createdAt_idx" ON "storage_usage_event" USING btree ("repository_id","created_at");
--> statement-breakpoint
CREATE INDEX "storage_usage_event_runId_idx" ON "storage_usage_event" USING btree ("run_id");
