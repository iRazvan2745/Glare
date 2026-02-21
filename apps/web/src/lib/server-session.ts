import { headers } from "next/headers";
import { getAuth } from "@glare/auth";

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
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return null;
  }

  return session as ServerAuthSession;
}
