import { db } from "@glare/db";
import { workspaceSettings } from "@glare/db/schema/settings";
import { user } from "@glare/db/schema/auth";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { hasRoleAtLeast } from "../../shared/auth/authorization";

const updateUserType = type({
  "name?": "string >= 1 <= 120",
  "email?": "string.email",
});

const updateWorkspaceSettingsType = type({
  "signupsEnabled?": "boolean",
});

async function getOrCreateWorkspaceSettings() {
  const existing = await db.query.workspaceSettings.findFirst({
    where: (table, { eq }) => eq(table.id, "default"),
  });
  if (existing) return existing;
  await db.insert(workspaceSettings).values({ id: "default" }).onConflictDoNothing();
  return { id: "default", signupsEnabled: true, createdAt: new Date(), updatedAt: new Date() };
}

export const adminRoutes = new Elysia()
  .get("/api/public/signup-status", async () => {
    const settings = await getOrCreateWorkspaceSettings();
    return { signupsEnabled: settings.signupsEnabled };
  })
  .get("/api/admin/settings", async ({ request, status }) => {
    const authedUser = await getAuthenticatedUser(request);
    if (!authedUser || !hasRoleAtLeast(authedUser, "admin")) {
      return status(403, { error: "Forbidden" });
    }
    const settings = await getOrCreateWorkspaceSettings();
    return { settings: { signupsEnabled: settings.signupsEnabled } };
  })
  .patch("/api/admin/settings", async ({ request, body, status }) => {
    const authedUser = await getAuthenticatedUser(request);
    if (!authedUser || !hasRoleAtLeast(authedUser, "admin")) {
      return status(403, { error: "Forbidden" });
    }
    if (!updateWorkspaceSettingsType.allows(body)) {
      return status(400, { error: "Invalid payload" });
    }
    const updates = body as { signupsEnabled?: boolean };
    await db
      .insert(workspaceSettings)
      .values({ id: "default", ...updates })
      .onConflictDoUpdate({ target: workspaceSettings.id, set: updates });
    const settings = await getOrCreateWorkspaceSettings();
    return { settings: { signupsEnabled: settings.signupsEnabled } };
  })
  .patch("/api/admin/users/:userId", async ({ request, body, params, status }) => {
    const authedUser = await getAuthenticatedUser(request);
    if (!authedUser || !hasRoleAtLeast(authedUser, "admin")) {
      return status(403, { error: "Forbidden" });
    }
    if (!updateUserType.allows(body)) {
      return status(400, { error: "Invalid payload" });
    }
    const updates = body as { name?: string; email?: string };
    if (Object.keys(updates).length === 0) {
      return status(400, { error: "No fields to update" });
    }
    await db.update(user).set(updates).where(eq(user.id, params.userId));
    return { success: true };
  })
  .delete("/api/admin/users/:userId", async ({ request, params, status }) => {
    const authedUser = await getAuthenticatedUser(request);
    if (!authedUser || !hasRoleAtLeast(authedUser, "admin")) {
      return status(403, { error: "Forbidden" });
    }
    if (authedUser.id === params.userId) {
      return status(400, { error: "Cannot delete your own account" });
    }
    await db.delete(user).where(eq(user.id, params.userId));
    return { success: true };
  });
