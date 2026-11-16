import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { UnsubForm } from "./UnsubForm";

export const metadata: Metadata = { title: "oovi news emails", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Opened from the link at the bottom of a news email. It asks first (mail scanners open links on their
// own); mail apps' one-click unsubscribe goes to /api/v1/unsubscribe instead.
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <AuthShell>
      <h1>oovi news by email</h1>
      <UnsubForm token={String(t ?? "").slice(0, 300)} />
    </AuthShell>
  );
}
