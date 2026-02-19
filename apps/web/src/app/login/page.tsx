import LoginPageClient from "@/components/login-page-client";
import { getServerSession } from "@/lib/server-session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await getServerSession();
  if (session?.user) {
    redirect("/");
  }

  return <LoginPageClient />;
}
