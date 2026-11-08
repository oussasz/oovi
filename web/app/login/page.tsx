import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { getServerSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getServerSession();
  if (session) redirect("/account");
  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="sub">Log in to your oovi account.</p>
      <LoginForm />
    </AuthShell>
  );
}
