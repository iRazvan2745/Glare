ALTER TABLE "backup_plan" ADD COLUMN IF NOT EXISTS "run_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "backup_plan" ADD COLUMN IF NOT EXISTS "run_lease_owner" text;
