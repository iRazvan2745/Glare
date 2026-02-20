import { cors } from "@elysiajs/cors";
import openapi from "@elysiajs/openapi";
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
  logRequest,
  markRequestStart,
} from "./shared/logger";
import { healthSnapshot } from "./shared/startup-health";

export type ApiAppOptions = {
  corsOrigin?: string;
};

export function createApiApp(options: ApiAppOptions = {}) {
  const defaultOrigin =
    process.env.NEXT_APP_URL ??
    process.env.APP_URL ??
    process.env.CORS_ORIGIN ??
    "http://localhost:3002";
  const corsOrigin = options.corsOrigin ?? defaultOrigin;

  return new Elysia()
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
    .use(
      cors({
        origin: corsOrigin,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
      }),
    )
    .get("/", () => "OK")
    .get("/health", async () => {
      const snapshot = await healthSnapshot();
      const status = snapshot.ok ? 200 : 503;
      return new Response(JSON.stringify(snapshot), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    })
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
}

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export function getApiApp() {
  if (!cachedApp) {
    cachedApp = createApiApp();
  }
  return cachedApp;
}

export function handleApiRequest(request: Request) {
  return getApiApp().handle(request);
}
