import { getAuth } from "@glare/auth";

export async function getAuthenticatedUser(request: Request) {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return session?.user ?? null;
}
