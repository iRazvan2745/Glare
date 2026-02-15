ALTER TABLE "backup_plan" ADD COLUMN "worker_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD CONSTRAINT "backup_plan_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_plan_workerId_idx" ON "backup_plan" USING btree ("worker_id");