ALTER TABLE "backup_plan" ADD COLUMN "run_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "run_lease_owner" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "discord_webhook_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "discord_webhook_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notify_on_backup_failures" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notify_on_worker_health" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notify_on_repo_changes" boolean DEFAULT false NOT NULL;