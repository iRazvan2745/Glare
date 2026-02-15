import { env } from "@glare/env/web";
import { createAuthClient } from "better-auth/react";
import { adminClient, lastLoginMethodClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: env.NEXT_PUBLIC_SERVER_URL,
  plugins: [adminClient(), lastLoginMethodClient()],
});
