import { requireAdminUser } from "@/lib/require-admin-user";
import { AdminShell } from "./_components/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminUser();

  return <AdminShell>{children}</AdminShell>;
}
