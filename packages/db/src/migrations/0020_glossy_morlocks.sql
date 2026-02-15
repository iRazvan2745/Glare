CREATE TABLE "backup_plan_worker" (
	"plan_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_sync_event" (
	"id" text PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"status" text NOT NULL,
	"uptime_ms" bigint NOT NULL,
	"requests_total" bigint NOT NULL,
	"error_total" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_plan_worker" ADD CONSTRAINT "backup_plan_worker_plan_id_backup_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_plan_worker" ADD CONSTRAINT "backup_plan_worker_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_sync_event" ADD CONSTRAINT "worker_sync_event_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_plan_worker_unique_idx" ON "backup_plan_worker" USING btree ("plan_id","worker_id");--> statement-breakpoint
CREATE INDEX "backup_plan_worker_workerId_idx" ON "backup_plan_worker" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_sync_event_worker_created_idx" ON "worker_sync_event" USING btree ("worker_id","created_at");--> statement-breakpoint
CREATE INDEX "worker_sync_event_created_idx" ON "worker_sync_event" USING btree ("created_at");