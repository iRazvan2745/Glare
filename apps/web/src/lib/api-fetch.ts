export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiFetchJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  onUnauthorized?: () => void;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetchJson<T>(input: RequestInfo | URL, options: ApiFetchJsonOptions = {}) {
  const {
    timeoutMs = 10_000,
    retries = 1,
    retryDelayMs = 350,
    onUnauthorized,
    credentials = "include",
    ...init
  } = options;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, {
        ...init,
        credentials,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json")
        ? ((await response.json()) as unknown)
        : ((await response.text()) as unknown);

      if (response.status === 401) {
        onUnauthorized?.();
      }

      if (!response.ok) {
        const message =
          typeof body === "object" && body && "error" in body
            ? String((body as { error?: unknown }).error ?? `Request failed with ${response.status}`)
            : `Request failed with ${response.status}`;
        throw new ApiError(message, response.status, body);
      }

      return body as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(retryDelayMs);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
