import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { getServerSession } from "@/lib/session";
import { safeNext } from "@/lib/form";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const session = await getServerSession();
  if (session) redirect(next ?? "/account");
  return (
    <AuthShell>
      <h1>Create your account</h1>
      <p className="sub">One account to sign in to the oovi app. Free during the pilot.</p>
      <SignupForm next={next} />
    </AuthShell>
  );
}
