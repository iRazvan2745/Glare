import { db } from "@glare/db";
import * as schema from "@glare/db/schema/auth";
import { env } from "@glare/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { lastLoginMethod } from "better-auth/plugins";

const configuredServerBaseUrl = env.BETTER_AUTH_BASE_URL || env.BETTER_AUTH_URL;
const configuredCorsOrigin = env.CORS_ORIGIN;
const trustedOrigins = Array.from(
  new Set(
    [configuredCorsOrigin, env.WEB_ORIGIN, env.NEXT_PUBLIC_APP_URL]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.replace(/\/+$/, "")),
  ),
);
const isProduction = env.NODE_ENV === "production";

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
      sameSite: "lax",
      secure: isProduction,
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
