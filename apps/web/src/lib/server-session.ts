import { env } from "@glare/env/web";
import { headers } from "next/headers";

type ServerAuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    role?: string | null;
    banned?: boolean | null;
  } | null;
};

export async function getServerSession(): Promise<ServerAuthSession | null> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");

  const response = await fetch(`${env.NEXT_PUBLIC_SERVER_URL}/api/auth/get-session`, {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const parsed = (await response.json().catch(() => null)) as ServerAuthSession | null;
  if (!parsed?.user) {
    return null;
  }

  return parsed;
}
