import { redirect } from "next/navigation";
import { getServerSession } from "./server-session";

const ADMIN_ROLES = new Set(["admin", "owner"]);

export async function requireAdminUser() {
  const session = await getServerSession();
  const user = session?.user;

  if (!user) {
    redirect("/login");
  }

  const role = (user.role ?? "").trim().toLowerCase();
  if (!ADMIN_ROLES.has(role)) {
    redirect("/");
  }

  return user;
}
