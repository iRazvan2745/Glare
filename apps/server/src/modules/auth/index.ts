import { auth } from "@glare/auth";
import { db } from "@glare/db";
import { workspaceSettings } from "@glare/db/schema/settings";
import { Elysia } from "elysia";

async function isSignupsEnabled(): Promise<boolean> {
  const settings = await db.query.workspaceSettings.findFirst({
    where: (table, { eq }) => eq(table.id, "default"),
  });
  return settings?.signupsEnabled ?? true;
}

export const authRoutes = new Elysia().all("/api/auth/*", async ({ request, status }) => {
  if (["POST", "GET"].includes(request.method)) {
    if (request.method === "POST") {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/sign-up/email")) {
        const enabled = await isSignupsEnabled();
        if (!enabled) {
          return new Response(
            JSON.stringify({ message: "Sign-ups are currently disabled by the administrator" }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
      }
    }
    return auth.handler(request);
  }

  return status(405);
});
