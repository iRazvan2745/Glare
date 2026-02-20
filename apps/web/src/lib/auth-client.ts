import { createAuthClient } from "better-auth/react";
import { adminClient, lastLoginMethodClient } from "better-auth/client/plugins";
import { apiBaseUrl } from "./api-base-url";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  plugins: [adminClient(), lastLoginMethodClient()],
});
