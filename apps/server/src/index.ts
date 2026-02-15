import { cors } from "@elysiajs/cors";
import { env } from "@glare/env/server";
import { Elysia } from "elysia";
import { authRoutes } from "./modules/auth/index";
import { rusticRoutes } from "./modules/rustic/index";
import { settingsRoutes } from "./modules/settings/index";
import { statsRoutes } from "./modules/stats/index";
import { workerRoutes } from "./modules/workers/index";
import { getRequestId, logError, logInfo, logRequest, markRequestStart } from "./shared/logger";
import { healthSnapshot, verifyStartupHealth } from "./shared/startup-health";

const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Glare Server API",
    version: "1.0.0",
    description: "Internal API for auth, worker management, and Rustic stats.",
  },
  servers: [{ url: "http://localhost:3000" }],
  tags: [{ name: "Rustic", description: "Rustic and worker stats endpoints for app integration." }],
  paths: {
    "/api/rustic/endpoints": {
      get: {
        tags: ["Rustic"],
        summary: "List Rustic API endpoints",
      },
    },
    "/api/rustic/stats/summary": {
      get: {
        tags: ["Rustic"],
        summary: "Get Rustic summary stats",
      },
    },
    "/api/rustic/stats/repositories": {
      get: {
        tags: ["Rustic"],
        summary: "Get repository stats and breakdown",
      },
    },
    "/api/rustic/repositories": {
      get: {
        tags: ["Rustic"],
        summary: "List Rustic repositories",
      },
      post: {
        tags: ["Rustic"],
        summary: "Create Rustic repository",
      },
    },
    "/api/rustic/repositories/{id}": {
      get: {
        tags: ["Rustic"],
        summary: "Get repository",
      },
      patch: {
        tags: ["Rustic"],
        summary: "Update repository",
      },
      delete: {
        tags: ["Rustic"],
        summary: "Delete repository",
      },
    },
    "/api/rustic/repositories/{id}/init": {
      post: {
        tags: ["Rustic"],
        summary: "Initialize repository on primary worker",
      },
    },
    "/api/rustic/repositories/{id}/snapshots": {
      post: {
        tags: ["Rustic"],
        summary: "List snapshots for repository",
      },
    },
    "/api/rustic/repositories/{id}/snapshot-workers": {
      get: {
        tags: ["Rustic"],
        summary: "List worker attribution for repository snapshots",
      },
    },
    "/api/rustic/repositories/{id}/snapshot/files": {
      post: {
        tags: ["Rustic"],
        summary: "List files for repository snapshot",
      },
    },
    "/api/rustic/repositories/{id}/backup": {
      post: {
        tags: ["Rustic"],
        summary: "Trigger repository backup now",
      },
    },
    "/api/rustic/plans": {
      get: {
        tags: ["Rustic"],
        summary: "List backup plans",
      },
      post: {
        tags: ["Rustic"],
        summary: "Create backup plan",
      },
    },
    "/api/rustic/plans/{id}": {
      patch: {
        tags: ["Rustic"],
        summary: "Update backup plan",
      },
      delete: {
        tags: ["Rustic"],
        summary: "Delete backup plan",
      },
    },
    "/api/rustic/plans/{id}/runs": {
      get: {
        tags: ["Rustic"],
        summary: "List backup plan runs",
      },
    },
    "/api/rustic/events": {
      get: {
        tags: ["Rustic"],
        summary: "List backup events",
      },
    },
    "/api/rustic/plans/{id}/run": {
      post: {
        tags: ["Rustic"],
        summary: "Run backup plan now",
      },
    },
    "/api/workers/rustic/stats": {
      get: {
        tags: ["Rustic"],
        summary: "Get Rustic stats for all workers",
      },
    },
    "/api/workers/{id}/rustic/stats": {
      get: {
        tags: ["Rustic"],
        summary: "Get Rustic stats for one worker",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
  },
} as const;

function renderScalarHtml(openApiJsonUrl: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Glare API Reference</title>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${openApiJsonUrl}"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
    ></script>
  </body>
</html>`;
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
  .get("/openapi/json", () => OPENAPI_DOCUMENT)
  .get("/openapi", ({ request }) => {
    const origin = new URL(request.url).origin;
    const html = renderScalarHtml(`${origin}/openapi/json`);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  })
  .use(authRoutes)
  .use(settingsRoutes)
  .use(statsRoutes)
  .use(workerRoutes)
  .use(rusticRoutes);

await verifyStartupHealth();

app.listen(3000, () => {
  logInfo("server is running", { url: "http://localhost:3000", corsOrigin: env.CORS_ORIGIN });
});

export default app;
