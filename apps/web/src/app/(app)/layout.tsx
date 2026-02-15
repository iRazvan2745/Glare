import Sidebar from "@/components/sidebar";
import { requireAuthUser } from "@/lib/require-auth-user";

export default async function AppLayout({ children }: { children: React.ReactNode }) {

  //await requireAuthUser()

  return <Sidebar>{children}</Sidebar>;
}
