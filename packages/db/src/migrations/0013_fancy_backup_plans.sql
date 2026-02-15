CREATE TABLE "backup_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"name" text NOT NULL,
	"cron" text NOT NULL,
	"paths_json" text NOT NULL,
	"tags_json" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_status" text,
	"last_error" text,
	"last_duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_plan" ADD CONSTRAINT "backup_plan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_plan" ADD CONSTRAINT "backup_plan_repository_id_rustic_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "backup_plan_userId_idx" ON "backup_plan" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "backup_plan_repositoryId_idx" ON "backup_plan" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX "backup_plan_enabled_nextRunAt_idx" ON "backup_plan" USING btree ("enabled","next_run_at");
