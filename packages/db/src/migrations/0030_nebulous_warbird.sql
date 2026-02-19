CREATE TABLE "workspace_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"signups_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
