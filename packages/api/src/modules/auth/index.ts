import { getAuth } from "@glare/auth";
import { Elysia } from "elysia";
import { logError } from "../../shared/logger";

async function isSignupsEnabled(): Promise<boolean> {
  try {
    const { db } = await import("@glare/db");
    const settings = await db.query.workspaceSettings.findFirst({
      where: (table, { eq }) => eq(table.id, "default"),
    });
    return settings?.signupsEnabled ?? true;
  } catch (error) {
    logError("failed to load signup settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const authRoutes = new Elysia().all("/api/auth/*", async ({ request, status }) => {
  if (["POST", "GET"].includes(request.method)) {
    if (request.method === "POST") {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sign-up/email")) {
        let enabled: boolean;
        try {
          enabled = await isSignupsEnabled();
        } catch {
          return new Response(JSON.stringify({ message: "Service temporarily unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        if (!enabled) {
          return new Response(
            JSON.stringify({ message: "Sign-ups are currently disabled by the administrator" }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
      }
    }
    const auth = await getAuth();
    return auth.handler(request);
  }

  return status(405);
});
