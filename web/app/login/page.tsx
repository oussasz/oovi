import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { getServerSession } from "@/lib/session";
import { safeNext } from "@/lib/form";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const session = await getServerSession();
  if (session) redirect(next ?? "/account");
  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="sub">Log in to your oovi account.</p>
      <LoginForm next={next} />
    </AuthShell>
  );
}
