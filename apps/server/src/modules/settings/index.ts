import { db } from "@glare/db";
import { userSettings } from "@glare/db/schema/settings";
import { type } from "arktype";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";

const settingsType = type({
  productUpdates: "boolean",
  workerEvents: "boolean",
  weeklySummary: "boolean",
  newSigninAlerts: "boolean",
});
const settingsSchema = {
  safeParse(input: unknown) {
    if (!settingsType.allows(input)) {
      return { success: false as const };
    }
    return { success: true as const, data: input as typeof settingsType.infer };
  },
};

const defaultSettings = {
  productUpdates: true,
  workerEvents: true,
  weeklySummary: false,
  newSigninAlerts: true,
} as const;

export const settingsRoutes = new Elysia()
  .get("/api/settings", async ({ request, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const existing = await db.query.userSettings.findFirst({
      where: (table, { eq }) => eq(table.userId, user.id),
    });

    if (existing) {
      return {
        settings: {
          productUpdates: existing.productUpdates,
          workerEvents: existing.workerEvents,
          weeklySummary: existing.weeklySummary,
          newSigninAlerts: existing.newSigninAlerts,
        },
      };
    }

    await db.insert(userSettings).values({
      userId: user.id,
      ...defaultSettings,
    });

    return { settings: defaultSettings };
  })
  .post("/api/settings", async ({ request, body, status }) => {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return status(401, { error: "Unauthorized" });
    }

    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { error: "Invalid settings payload" });
    }

    await db
      .insert(userSettings)
      .values({
        userId: user.id,
        ...parsed.data,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: parsed.data,
      });

    return { settings: parsed.data };
  });
