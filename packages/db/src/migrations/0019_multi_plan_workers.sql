CREATE TABLE "backup_plan_worker" (
  "plan_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_plan_worker" ADD CONSTRAINT "backup_plan_worker_plan_id_backup_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_plan_worker" ADD CONSTRAINT "backup_plan_worker_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_plan_worker_unique_idx" ON "backup_plan_worker" USING btree ("plan_id","worker_id");
--> statement-breakpoint
CREATE INDEX "backup_plan_worker_workerId_idx" ON "backup_plan_worker" USING btree ("worker_id");
--> statement-breakpoint
INSERT INTO "backup_plan_worker" ("plan_id", "worker_id")
SELECT "id", "worker_id"
FROM "backup_plan"
WHERE "worker_id" IS NOT NULL
ON CONFLICT DO NOTHING;
