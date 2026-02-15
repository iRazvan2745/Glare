const requestStartTimes = new WeakMap<Request, number>();
const requestIds = new WeakMap<Request, string>();

function nowMs() {
  return performance.now();
}

function nextRequestId() {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeMeta(meta?: Record<string, unknown>) {
  if (!meta) return {};
  return meta;
}

function structuredLog(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) {
  const payload = {
    scope: "server",
    level,
    message,
    ...normalizeMeta(meta),
  };
  const line = JSON.stringify(payload);
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
  structuredLog("info", message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
  structuredLog("warn", message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>) {
  structuredLog("error", message, meta);
}

export function markRequestStart(request: Request) {
  requestStartTimes.set(request, nowMs());
  requestIds.set(request, nextRequestId());
}

export function getRequestId(request: Request) {
  return requestIds.get(request);
}

export function logRequest(request: Request, statusCode: number | string | undefined) {
  const startedAt = requestStartTimes.get(request);
  const requestId = requestIds.get(request);
  const durationMs = startedAt === undefined ? null : nowMs() - startedAt;
  const pathname = new URL(request.url).pathname;
  const code = typeof statusCode === "number" ? statusCode : 200;

  logInfo("request", {
    requestId,
    method: request.method,
    path: pathname,
    status: code,
    durationMs: durationMs === null ? undefined : Number(durationMs.toFixed(1)),
  });
}
