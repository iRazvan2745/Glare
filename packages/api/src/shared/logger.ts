import pino from "pino";
import pretty from "pino-pretty";

const isDev = process.env.NODE_ENV === "development";

const logger = pino(
  {
    base: { scope: "server" },
    level: "info",
  },
  isDev ? pretty({ colorize: true }) : undefined,
);

const requestStartTimes = new WeakMap<Request, number>();
const requestIds = new WeakMap<Request, string>();

function nowMs() {
  return performance.now();
}

function nextRequestId() {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
  logger.info(meta ?? {}, message);
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
  logger.warn(meta ?? {}, message);
}

export function logError(message: string, meta?: Record<string, unknown>) {
  logger.error(meta ?? {}, message);
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
  let pathname = request.url;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    pathname = request.url;
  }

  let code: number | undefined;
  if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
    code = statusCode;
  } else if (typeof statusCode === "string") {
    const parsed = Number(statusCode);
    if (Number.isFinite(parsed)) {
      code = parsed;
    }
  }

  logInfo("request", {
    requestId,
    method: request.method,
    path: pathname,
    status: code,
    durationMs: durationMs === null ? undefined : Number(durationMs.toFixed(1)),
  });
}
