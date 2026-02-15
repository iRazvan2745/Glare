ALTER TABLE "worker" ADD COLUMN "user_id" text;

UPDATE "worker" AS w
SET "user_id" = picked."user_id"
FROM (
  SELECT DISTINCT ON (m."organization_id")
    m."organization_id",
    m."user_id"
  FROM "member" AS m
  ORDER BY
    m."organization_id",
    CASE m."role"
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      ELSE 2
    END,
    m."created_at"
) AS picked
WHERE picked."organization_id" = w."organization_id";

DELETE FROM "worker" WHERE "user_id" IS NULL;

ALTER TABLE "worker" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "worker" ADD CONSTRAINT "worker_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "worker_userId_idx" ON "worker" USING btree ("user_id");

ALTER TABLE "worker" DROP CONSTRAINT "worker_organization_id_organization_id_fk";
DROP INDEX IF EXISTS "worker_organizationId_idx";
ALTER TABLE "worker" DROP COLUMN "organization_id";

ALTER TABLE "session" DROP COLUMN IF EXISTS "active_organization_id";
DROP TABLE IF EXISTS "invitation" CASCADE;
DROP TABLE IF EXISTS "member" CASCADE;
DROP TABLE IF EXISTS "organization" CASCADE;
