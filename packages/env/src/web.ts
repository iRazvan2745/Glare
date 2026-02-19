import { getEnv } from "./get-env";

export const env = {
  NEXT_PUBLIC_SERVER_URL: getEnv("NEXT_PUBLIC_SERVER_URL", { fallback: "http://localhost:3000" }),
};
