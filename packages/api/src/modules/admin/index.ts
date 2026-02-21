import { db } from "@glare/db";
import { workspaceSettings } from "@glare/db/schema/settings";
import { user } from "@glare/db/schema/auth";
import { type } from "arktype";
import { and, eq, ne } from "drizzle-orm";
import { Elysia } from "elysia";
import { getAuthenticatedUser } from "../../shared/auth/session";
import { hasRoleAtLeast, ROLE_RANK } from "../../shared/auth/authorization";

const updateUserType = type({
  "name?": "string",
  "email?": "string.email",
});

const updateWorkspaceSettingsType = type({
  "signupsEnabled?": "boolean",
});

function roleRank(role: string | null | undefined) {
  const normalized = (role ?? "member").trim().toLowerCase();
  if (normalized in ROLE_RANK) {
    return ROLE_RANK[normalized as keyof typeof ROLE_RANK];
  }
  return 0;
}

const SIGNUP_STATUS_CACHE_TTL_MS = 5_000;
let signupStatusCache:
  | {
      value: boolean;
      expiresAt: number;
    }
  | undefined;

function isEmailUniqueConstraintError(error: unknown) {
  const candidate = error as
    | {
        code?: string;
        detail?: string;
        constraint?: string;
        meta?: { target?: string | string[] };
        cause?: unknown;
      }
    | undefined;

  const matches = (
    current:
      | {
          code?: string;
          detail?: string;
          constraint?: string;
          meta?: { target?: string | string[] };
        }
      | undefined,
  ) => {
    if (!current) return false;
    if (current.code === "P2002") {
      const target = current.meta?.target;
      if (Array.isArray(target)) {
        return target.some((entry) => String(entry).toLowerCase().includes("email"));
      }
      return typeof target === "string" && target.toLowerCase().includes("email");
    }
    if (current.code === "23505") {
      const constraint = (current.constraint ?? "").toLowerCase();
      const detail = (current.detail ?? "").toLowerCase();
      return constraint.includes("email") || detail.includes("email");
    }
    return false;
  };

  if (matches(candidate)) {
    return true;
  }

  const causeCandidate = candidate?.cause as
    | {
        code?: string;
        detail?: string;
        constraint?: string;
        meta?: { target?: string | string[] };
      }
    | undefined;
  return matches(causeCandidate);
}

async function getOrCreateWorkspaceSettings() {
  const existing = await db.query.workspaceSettings.findFirst({
    where: (table, { eq }) => eq(table.id, "default"),
  });
  if (existing) return existing;
  await db.insert(workspaceSettings).values({ id: "default" }).onConflictDoNothing();
  const persisted = await db.query.workspaceSettings.findFirst({
    where: (table, { eq }) => eq(table.id, "default"),
  });
  if (persisted) return persisted;
  return { id: "default", signupsEnabled: true, createdAt: new Date(), updatedAt: new Date() };
}

export const adminRoutes = new Elysia()
  .get("/api/public/signup-status", async () => {
    if (signupStatusCache && signupStatusCache.expiresAt > Date.now()) {
      return { signupsEnabled: signupStatusCache.value };
    }
    const settings = await getOrCreateWorkspaceSettings();
    signupStatusCache = {
      value: settings.signupsEnabled,
      expiresAt: Date.now() + SIGNUP_STATUS_CACHE_TTL_MS,
    };
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
    signupStatusCache = {
      value: settings.signupsEnabled,
      expiresAt: Date.now() + SIGNUP_STATUS_CACHE_TTL_MS,
    };
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
    if (typeof updates.name === "string") {
      const trimmed = updates.name.trim();
      if (trimmed.length === 0 || trimmed.length > 120) {
        return status(400, { error: "Invalid payload" });
      }
      updates.name = trimmed;
    }
    if (Object.keys(updates).length === 0) {
      return status(400, { error: "No fields to update" });
    }

    const requesterUser = await db.query.user.findFirst({
      where: eq(user.id, authedUser.id),
      columns: { id: true, role: true },
    });
    if (!requesterUser) {
      return status(403, { error: "Forbidden" });
    }

    const targetUser = await db.query.user.findFirst({
      where: eq(user.id, params.userId),
      columns: { id: true, role: true },
    });
    if (!targetUser) {
      return status(404, { error: "User not found" });
    }
    const requesterRoleRank = roleRank(requesterUser.role);
    const targetRoleRank = roleRank(targetUser?.role);
    if (targetRoleRank >= requesterRoleRank) {
      return status(403, { error: "Forbidden" });
    }

    if (updates.email) {
      const existingEmailOwner = await db.query.user.findFirst({
        where: and(eq(user.email, updates.email), ne(user.id, params.userId)),
        columns: { id: true },
      });
      if (existingEmailOwner) {
        return status(409, { error: "Email already in use" });
      }
    }

    let updatedRows: Array<{ id: string }>;
    try {
      updatedRows = await db
        .update(user)
        .set(updates)
        .where(eq(user.id, params.userId))
        .returning({ id: user.id });
    } catch (error) {
      if (isEmailUniqueConstraintError(error)) {
        return status(409, { error: "Email already in use" });
      }
      throw error;
    }
    if (updatedRows.length === 0) {
      return status(404, { error: "User not found" });
    }

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

    const requesterUser = await db.query.user.findFirst({
      where: eq(user.id, authedUser.id),
      columns: { id: true, role: true },
    });
    if (!requesterUser) {
      return status(403, { error: "Forbidden" });
    }

    const targetUser = await db.query.user.findFirst({
      where: eq(user.id, params.userId),
      columns: { id: true, role: true },
    });
    if (!targetUser) {
      return status(404, { error: "User not found" });
    }
    const requesterRoleRank = roleRank(requesterUser.role);
    const targetRoleRank = roleRank(targetUser?.role);
    if (targetRoleRank >= requesterRoleRank) {
      return status(403, { error: "Forbidden" });
    }

    const deletedRows = await db
      .delete(user)
      .where(eq(user.id, params.userId))
      .returning({ id: user.id });
    if (deletedRows.length === 0) {
      return status(404, { error: "User not found" });
    }
    return { success: true };
  });
