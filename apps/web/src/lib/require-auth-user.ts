import { redirect } from "next/navigation";
import { authClient } from "./auth-client";

export async function requireAuthUser() {
  const session = await (await authClient.getSession()).data
  if (!session?.user) {
    redirect('/login');
  }
  return session.user;
}
