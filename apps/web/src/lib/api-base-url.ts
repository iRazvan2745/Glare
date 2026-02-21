const rawApiBaseUrl =
  process.env.NEXT_PUBLIC_NEXT_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

export const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, "");

export function withApiBase(path: string) {
  if (!apiBaseUrl) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
}
