CREATE TABLE "backup_plan_run" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"worker_id" text,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" integer,
	"snapshot_id" text,
	"snapshot_time" timestamp,
	"output_json" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "backup_plan_run" ADD CONSTRAINT "backup_plan_run_plan_id_backup_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_plan_run" ADD CONSTRAINT "backup_plan_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_plan_run" ADD CONSTRAINT "backup_plan_run_repository_id_rustic_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_plan_run" ADD CONSTRAINT "backup_plan_run_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "backup_plan_run_planId_startedAt_idx" ON "backup_plan_run" USING btree ("plan_id","started_at");
--> statement-breakpoint
CREATE INDEX "backup_plan_run_userId_startedAt_idx" ON "backup_plan_run" USING btree ("user_id","started_at");
