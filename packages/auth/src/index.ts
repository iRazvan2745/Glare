import { db } from "@glare/db";
import * as schema from "@glare/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { lastLoginMethod } from "better-auth/plugins";

const isProduction = process.env.NODE_ENV === "production";
const configuredBaseUrl =
  process.env.NEXT_APP_URL ||
  process.env.APP_URL ||
  process.env.BETTER_AUTH_BASE_URL ||
  process.env.BETTER_AUTH_URL ||
  (isProduction ? undefined : "http://localhost:3002");
const trustedOrigins = Array.from(
  new Set(
    [
      configuredBaseUrl,
      process.env.APP_URL,
      process.env.WEB_ORIGIN,
      process.env.NEXT_PUBLIC_APP_URL,
    ]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.replace(/\/+$/, "")),
  ),
);
export const auth = betterAuth({
  baseURL: configuredBaseUrl,
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
