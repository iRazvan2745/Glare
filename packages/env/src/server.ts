import "dotenv/config";

function getEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

type NodeEnv = "development" | "production" | "test";

export const env: {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGIN: string;
  NODE_ENV: NodeEnv;
} = {
  DATABASE_URL: getEnv("DATABASE_URL"),
  BETTER_AUTH_SECRET: getEnv("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: getEnv("BETTER_AUTH_URL"),
  CORS_ORIGIN: getEnv("CORS_ORIGIN", "http://localhost:3001"),
  NODE_ENV: (getEnv("NODE_ENV", "development") as NodeEnv),
};
