CREATE TABLE "rustic_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"worker_id" text,
	"name" text NOT NULL,
	"backend" text NOT NULL,
	"repository" text NOT NULL,
	"password" text,
	"options_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rustic_repository" ADD CONSTRAINT "rustic_repository_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rustic_repository" ADD CONSTRAINT "rustic_repository_worker_id_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "rustic_repository_userId_idx" ON "rustic_repository" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "rustic_repository_workerId_idx" ON "rustic_repository" USING btree ("worker_id");
