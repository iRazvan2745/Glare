import * as schema from "@glare/db/schema/auth";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { lastLoginMethod } from "better-auth/plugins";

const isProduction = process.env.NODE_ENV === "production";
const configuredBaseUrl =
  process.env.NEXT_APP_URL ||
  process.env.APP_URL ||
  process.env.BETTER_AUTH_BASE_URL ||
  process.env.BETTER_AUTH_URL ||
  (isProduction ? undefined : "http://localhost:3002");
if (isProduction && !configuredBaseUrl) {
  throw new Error(
    "Missing auth base URL in production. Set NEXT_APP_URL, APP_URL, BETTER_AUTH_BASE_URL, or BETTER_AUTH_URL.",
  );
}

const trustedOrigins = Array.from(
  new Set(
    [configuredBaseUrl, process.env.WEB_ORIGIN, process.env.NEXT_PUBLIC_APP_URL]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.replace(/\/+$/, "")),
  ),
);

let authPromise: Promise<ReturnType<typeof betterAuth>> | null = null;

export function getAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const [{ db }, { drizzleAdapter }] = await Promise.all([
        import("@glare/db"),
        import("better-auth/adapters/drizzle"),
      ]);

      return betterAuth({
        baseURL: configuredBaseUrl,
        database: drizzleAdapter(db, {
          provider: "pg",
          schema,
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
    })();
  }

  return authPromise;
}
