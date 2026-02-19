import "dotenv/config";
import { getEnv } from "./get-env";

type NodeEnv = "development" | "production" | "test";
const NODE_ENVS: NodeEnv[] = ["development", "production", "test"];

function getNodeEnv(): NodeEnv {
  const value = getEnv("NODE_ENV", { fallback: "development" });
  return NODE_ENVS.includes(value as NodeEnv) ? (value as NodeEnv) : "development";
}

export const env: {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_BASE_URL: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGIN: string;
  WEB_ORIGIN: string;
  NEXT_PUBLIC_APP_URL: string;
  NODE_ENV: NodeEnv;
} = {
  DATABASE_URL: getEnv("DATABASE_URL", { required: true }),
  BETTER_AUTH_SECRET: getEnv("BETTER_AUTH_SECRET", { required: true }),
  BETTER_AUTH_BASE_URL: getEnv("BETTER_AUTH_BASE_URL"),
  BETTER_AUTH_URL: getEnv("BETTER_AUTH_URL", { fallback: "http://localhost:3000" }),
  CORS_ORIGIN: getEnv("CORS_ORIGIN", { fallback: "http://localhost:3002" }),
  WEB_ORIGIN: getEnv("WEB_ORIGIN"),
  NEXT_PUBLIC_APP_URL: getEnv("NEXT_PUBLIC_APP_URL"),
  NODE_ENV: getNodeEnv(),
};
