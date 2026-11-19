import { redirect } from "next/navigation";

// The account page moved into the web app's Settings (owner, 2026-11-19: after sign-in, show the web app; the
// account information moves to Settings). Old links, emails and Paddle's return keep working.
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string; billing?: string }> }) {
  const { welcome, billing } = await searchParams;
  const q = new URLSearchParams();
  if (welcome === "1") q.set("welcome", "1");
  if (billing === "none" || billing === "unavailable") q.set("billing", billing);
  redirect(`/app/settings${q.size ? `?${q}` : ""}`);
}
