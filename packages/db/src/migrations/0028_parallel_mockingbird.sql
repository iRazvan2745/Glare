CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata_json" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_run_metric" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"plan_id" text,
	"worker_id" text,
	"snapshot_id" text,
	"snapshot_time" timestamp,
	"bytes_added" bigint NOT NULL,
	"bytes_processed" bigint NOT NULL,
	"files_new" integer,
	"files_changed" integer,
	"files_unmodified" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_size_anomaly" (
	"id" text PRIMARY KEY NOT NULL,
	"metric_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text,
	"repository_id" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"actual_bytes" bigint NOT NULL,
	"deviation_score" numeric(8, 3) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "entity_label" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"run_id" text,
	"bytes_added" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_metric" ADD CONSTRAINT "backup_run_metric_run_id_backup_plan_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backup_plan_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_metric" ADD CONSTRAINT "backup_run_metric_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_metric" ADD CONSTRAINT "backup_run_metric_repository_id_rustic_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_metric" ADD CONSTRAINT "backup_run_metric_plan_id_backup_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_run_metric" ADD CONSTRAINT "backup_run_metric_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_size_anomaly" ADD CONSTRAINT "backup_size_anomaly_metric_id_backup_run_metric_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."backup_run_metric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_size_anomaly" ADD CONSTRAINT "backup_size_anomaly_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_size_anomaly" ADD CONSTRAINT "backup_size_anomaly_plan_id_backup_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."backup_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_size_anomaly" ADD CONSTRAINT "backup_size_anomaly_repository_id_rustic_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_label" ADD CONSTRAINT "entity_label_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage_event" ADD CONSTRAINT "storage_usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage_event" ADD CONSTRAINT "storage_usage_event_repository_id_rustic_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."rustic_repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage_event" ADD CONSTRAINT "storage_usage_event_run_id_backup_plan_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backup_plan_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actorUserId_createdAt_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_createdAt_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_resourceType_resourceId_createdAt_idx" ON "audit_log" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_metric_userId_createdAt_idx" ON "backup_run_metric" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_metric_planId_createdAt_idx" ON "backup_run_metric" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_metric_repositoryId_createdAt_idx" ON "backup_run_metric" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_run_metric_runId_idx" ON "backup_run_metric" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "backup_size_anomaly_userId_detectedAt_idx" ON "backup_size_anomaly" USING btree ("user_id","detected_at");--> statement-breakpoint
CREATE INDEX "backup_size_anomaly_planId_detectedAt_idx" ON "backup_size_anomaly" USING btree ("plan_id","detected_at");--> statement-breakpoint
CREATE INDEX "backup_size_anomaly_repositoryId_detectedAt_idx" ON "backup_size_anomaly" USING btree ("repository_id","detected_at");--> statement-breakpoint
CREATE INDEX "backup_size_anomaly_status_detectedAt_idx" ON "backup_size_anomaly" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "entity_label_userId_entityType_entityId_idx" ON "entity_label" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_label_userId_key_value_idx" ON "entity_label" USING btree ("user_id","key","value");--> statement-breakpoint
CREATE INDEX "storage_usage_event_userId_createdAt_idx" ON "storage_usage_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_usage_event_repositoryId_createdAt_idx" ON "storage_usage_event" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_usage_event_runId_idx" ON "storage_usage_event" USING btree ("run_id");