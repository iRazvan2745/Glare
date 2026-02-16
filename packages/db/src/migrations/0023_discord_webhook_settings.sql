ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "discord_webhook_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "discord_webhook_url" text,
  ADD COLUMN IF NOT EXISTS "notify_on_backup_failures" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "notify_on_worker_health" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "notify_on_repo_changes" boolean DEFAULT false NOT NULL;
