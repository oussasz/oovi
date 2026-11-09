import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/lib/session";
import { toPublicUser } from "@/lib/api";
import { creditStatus, type CreditStatus } from "@/lib/credits";
import { requestIp } from "@/lib/request-ip";
import { AccountClient } from "./AccountClient";
import { CreditsCard } from "./CreditsCard";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/account");
  const { welcome } = await searchParams;
  let credits: CreditStatus | null = null;
  try {
    credits = await creditStatus(session.user.id, session.user.createdAt, await requestIp());
  } catch (err) {
    // Credits are optional on this page: show the rest even if they can't load.
    console.error("account credits failed", err instanceof Error ? err.message : err);
  }
  return (
    <>
      <SiteNav />
      <main className="container page">
        <AccountClient
          user={toPublicUser(session.user)}
          welcome={welcome === "1"}
          credits={credits ? <CreditsCard s={credits} /> : null}
        />
      </main>
      <SiteFooter />
    </>
  );
}
