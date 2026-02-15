ALTER TABLE "backup_plan_run" ADD COLUMN "type" text DEFAULT 'backup' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "prune_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_last" integer;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_daily" integer;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_weekly" integer;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_monthly" integer;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_yearly" integer;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN "keep_within" text;