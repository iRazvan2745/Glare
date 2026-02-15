ALTER TABLE "backup_plan" ADD COLUMN "worker_id" text;

UPDATE "backup_plan" AS bp
SET "worker_id" = rr."worker_id"
FROM "rustic_repository" AS rr
WHERE bp."repository_id" = rr."id";

DELETE FROM "backup_plan" WHERE "worker_id" IS NULL;

ALTER TABLE "backup_plan" ALTER COLUMN "worker_id" SET NOT NULL;

ALTER TABLE "backup_plan"
  ADD CONSTRAINT "backup_plan_worker_id_worker_id_fk"
  FOREIGN KEY ("worker_id") REFERENCES "public"."worker"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "backup_plan_workerId_idx" ON "backup_plan" USING btree ("worker_id");
