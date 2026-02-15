function getEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

export const env = {
  NEXT_PUBLIC_SERVER_URL: getEnv("NEXT_PUBLIC_SERVER_URL", "http://localhost:3000"),
};
