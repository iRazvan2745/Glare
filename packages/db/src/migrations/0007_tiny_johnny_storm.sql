ALTER TABLE "worker" ADD COLUMN "sync_token_hash" text;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "status" text DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "uptime_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "requests_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "error_total" bigint DEFAULT 0 NOT NULL;