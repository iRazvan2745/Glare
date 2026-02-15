import { db } from "@glare/db";
import * as schema from "@glare/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { lastLoginMethod } from "better-auth/plugins";

const defaultServerBaseUrl = "http://localhost:3000";
const defaultWebOrigin = "http://localhost:3002";
const configuredServerBaseUrl =
  process.env.BETTER_AUTH_BASE_URL || process.env.BETTER_AUTH_URL || defaultServerBaseUrl;
const configuredCorsOrigin = process.env.CORS_ORIGIN || defaultWebOrigin;
const trustedOrigins = Array.from(
  new Set(
    [configuredCorsOrigin, process.env.WEB_ORIGIN, process.env.NEXT_PUBLIC_APP_URL]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.replace(/\/+$/, "")),
  ),
);

export const auth = betterAuth({
  baseURL: configuredServerBaseUrl,
  database: drizzleAdapter(db, {
    provider: "pg",

    schema: schema,
  }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  plugins: [
    admin(),
    lastLoginMethod({
      storeInDatabase: true,
    }),
  ],
});
