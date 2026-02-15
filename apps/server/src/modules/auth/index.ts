import { auth } from "@glare/auth";
import { Elysia } from "elysia";

export const authRoutes = new Elysia().all("/api/auth/*", async ({ request, status }) => {
  if (["POST", "GET"].includes(request.method)) {
    return auth.handler(request);
  }

  return status(405);
});
