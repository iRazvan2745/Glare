ALTER TABLE "worker" ADD COLUMN "sync_token_hash" text;
ALTER TABLE "worker" ADD COLUMN "status" text DEFAULT 'offline' NOT NULL;
ALTER TABLE "worker" ADD COLUMN "last_seen_at" timestamp;
ALTER TABLE "worker" ADD COLUMN "uptime_ms" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "worker" ADD COLUMN "requests_total" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "worker" ADD COLUMN "error_total" bigint DEFAULT 0 NOT NULL;
