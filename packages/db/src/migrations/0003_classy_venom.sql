ALTER TABLE "invitation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "invitation" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "organization" CASCADE;--> statement-breakpoint
ALTER TABLE "worker" DROP CONSTRAINT "worker_organization_id_organization_id_fk";
--> statement-breakpoint
DROP INDEX "worker_organizationId_idx";--> statement-breakpoint
ALTER TABLE "worker" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "worker" ADD CONSTRAINT "worker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worker_userId_idx" ON "worker" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_organization_id";--> statement-breakpoint
ALTER TABLE "worker" DROP COLUMN "organization_id";