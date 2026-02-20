import { db } from "@glare/db";
import { entityLabel } from "@glare/db/schema/labels";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import { getAuthenticatedUser } from "../../shared/auth/session";

const ENTITY_TYPES = ["worker", "repository", "plan"] as const;
const labelEntityParamsSchema = type({
  entityType: "'worker' | 'repository' | 'plan'",
  entityId: "string",
});
const labelGroupsQuerySchema = type({
  "entityType?": "'worker' | 'repository' | 'plan'",
});
const updateLabelsBodySchema = type({
  labels: [
    {
      key: "string >= 1 & string <= 64",
      value: "string >= 1 & string <= 128",
    },
  ],
});

export const labelRoutes = new Elysia({ prefix: "/api" })
  .get(
    "/labels/groups",
    async ({ request, query, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) return status(401, { error: "Unauthorized" });
      if (
        !ENTITY_TYPES.includes((query.entityType ?? "repository") as (typeof ENTITY_TYPES)[number])
      ) {
        return status(400, { error: "Invalid entity type" });
      }

      const rows = await db.$client.query(
        `
      SELECT "key", "value", COUNT(*)::int AS count
      FROM "entity_label"
      WHERE "user_id" = $1
        AND "entity_type" = $2
      GROUP BY "key", "value"
      ORDER BY "key" ASC, "value" ASC
      `,
        [user.id, query.entityType ?? "repository"],
      );

      return { groups: rows.rows };
    },
    {
      query: labelGroupsQuerySchema,
    },
  )
  .get(
    "/labels/:entityType/:entityId",
    async ({ request, params, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) return status(401, { error: "Unauthorized" });
      if (!ENTITY_TYPES.includes(params.entityType as (typeof ENTITY_TYPES)[number])) {
        return status(400, { error: "Invalid entity type" });
      }

      const rows = await db.query.entityLabel.findMany({
        where: and(
          eq(entityLabel.userId, user.id),
          eq(entityLabel.entityType, params.entityType),
          eq(entityLabel.entityId, params.entityId),
        ),
        columns: {
          key: true,
          value: true,
        },
        orderBy: (table, { asc }) => [asc(table.key), asc(table.value)],
      });

      return { labels: rows };
    },
    {
      params: labelEntityParamsSchema,
    },
  )
  .put(
    "/labels/:entityType/:entityId",
    async ({ request, params, body, status }) => {
      const user = await getAuthenticatedUser(request);
      if (!user) return status(401, { error: "Unauthorized" });
      if (!ENTITY_TYPES.includes(params.entityType as (typeof ENTITY_TYPES)[number])) {
        return status(400, { error: "Invalid entity type" });
      }
      if (body.labels.length > 32) {
        return status(400, { error: "Too many labels" });
      }

      const cleaned = body.labels
        .map((item) => ({
          key: item.key.trim().toLowerCase(),
          value: item.value.trim(),
        }))
        .filter((item) => item.key.length > 0 && item.value.length > 0);
      
      // Deduplicate by key+value combination while preserving order
      const seen = new Set<string>();
      const deduplicated = cleaned.filter((item) => {
        const combined = `${item.key}\0${item.value}`;
        if (seen.has(combined)) return false;
        seen.add(combined);
        return true;
      }).slice(0, 32);

      await db.transaction(async (tx) => {
        await tx
          .delete(entityLabel)
          .where(
            and(
              eq(entityLabel.userId, user.id),
              eq(entityLabel.entityType, params.entityType),
              eq(entityLabel.entityId, params.entityId),
            ),
          );

        if (deduplicated.length > 0) {
          await tx.insert(entityLabel).values(
            deduplicated.map((item) => ({
              id: crypto.randomUUID(),
              userId: user.id,
              entityType: params.entityType,
              entityId: params.entityId,
              key: item.key,
              value: item.value,
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
          );
        }
      });

      return { labels: deduplicated };
    },
    {
      params: labelEntityParamsSchema,
      body: updateLabelsBodySchema,
    },
  );
