import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { getServerSession } from "@/lib/session";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const session = await getServerSession();
  if (session) redirect("/account");
  return (
    <AuthShell>
      <h1>Create your account</h1>
      <p className="sub">One account to sign in to the oovi app. Free during the pilot.</p>
      <SignupForm />
    </AuthShell>
  );
}
