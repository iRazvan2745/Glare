import { redirect } from "next/navigation";
import { getServerSession } from "./server-session";

export async function requireAuthUser() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user;
}
