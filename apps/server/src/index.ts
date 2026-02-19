import { cors } from "@elysiajs/cors";
import { runMigrations } from "@glare/db";
import { env } from "@glare/env/server";
import { Elysia } from "elysia";
import { adminRoutes } from "./modules/admin/index";
import { authRoutes } from "./modules/auth/index";
import { auditRoutes } from "./modules/audit/index";
import { complianceRoutes } from "./modules/compliance/index";
import { labelRoutes } from "./modules/labels/index";
import { observabilityRoutes } from "./modules/observability/index";
import { rusticRoutes } from "./modules/rustic/index";
import { settingsRoutes } from "./modules/settings/index";
import { statsRoutes } from "./modules/stats/index";
import { workerRoutes } from "./modules/workers/index";
import {
  getRequestId,
  logError,
  logInfo,
  logRequest,
  logWarn,
  markRequestStart,
} from "./shared/logger";
import { startSnapshotSyncInterval } from "./shared/snapshot-sync";
import { healthSnapshot, verifyStartupHealth } from "./shared/startup-health";
import openapi from "@elysiajs/openapi";
import type { url } from "arktype/internal/keywords/string.ts";

function getPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  if ("cause" in error) {
    return getPostgresErrorCode((error as { cause?: unknown }).cause);
  }
  return undefined;
}

const app = new Elysia()
  .onRequest(({ request }) => {
    markRequestStart(request);
  })
  .onError(({ request, error, set }) => {
    logError("request handler error", {
      requestId: getRequestId(request),
      method: request.method,
      path: new URL(request.url).pathname,
      status: set.status,
      error: error instanceof Error ? error.message : String(error),
    });
  })
  .onAfterHandle(({ request, set }) => {
    const requestId = getRequestId(request);
    if (requestId) {
      set.headers["x-request-id"] = requestId;
    }
    logRequest(request, set.status);
  })
  .get("/", () => "OK")
  .get("/health", async () => {
    const snapshot = await healthSnapshot();
    const status = snapshot.ok ? 200 : 503;
    return new Response(JSON.stringify(snapshot), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  })
  .use(
    cors({
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .use(openapi())
  .use(adminRoutes)
  .use(authRoutes)
  .use(auditRoutes)
  .use(complianceRoutes)
  .use(labelRoutes)
  .use(settingsRoutes)
  .use(observabilityRoutes)
  .use(statsRoutes)
  .use(workerRoutes)
  .use(rusticRoutes);

try {
  await runMigrations();
} catch (error) {
  const postgresCode = getPostgresErrorCode(error);
  if (postgresCode === "42P07") {
    logWarn("migration skipped due to existing relation", {
      postgresCode,
      error: error instanceof Error ? error.message : String(error),
    });
  } else {
    throw error;
  }
}
await verifyStartupHealth();
startSnapshotSyncInterval();

app.listen(3000, () => {
  logInfo("server is running", { url: app.route, corsOrigin: env.CORS_ORIGIN });
});

export default app;
