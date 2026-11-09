import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/lib/session";
import { toPublicUser } from "@/lib/api";
import { creditStatus, type CreditStatus } from "@/lib/credits";
import { requestIp } from "@/lib/request-ip";
import { smtpStatus } from "@/lib/mail";
import { ResendVerification } from "@/components/ResendVerification";
import { AccountClient } from "./AccountClient";
import { CreditsCard } from "./CreditsCard";
import { BillingCard } from "./BillingCard";
import { billingFor } from "@/lib/billing";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string; billing?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/account");
  const { welcome, billing: billingNotice } = await searchParams;
  // Paddle billing for this account (null: never subscribed). Optional, like credits.
  const billing = await billingFor(session.user.id).catch((err) => {
    console.error("account billing failed", err instanceof Error ? err.message : err);
    return null;
  });
  let credits: CreditStatus | null = null;
  try {
    credits = await creditStatus(session.user.id, session.user.createdAt, await requestIp(), !!session.user.emailVerified);
  } catch (err) {
    // Credits are optional on this page: show the rest even if they can't load.
    console.error("account credits failed", err instanceof Error ? err.message : err);
  }
  // Only ask people to confirm when an email can actually be sent.
  const askToVerify =
    !session.user.emailVerified &&
    (await smtpStatus()
      .then((s) => s.ready)
      .catch(() => false));
  return (
    <>
      <SiteNav />
      <main className="container page">
        <AccountClient
          user={toPublicUser(session.user)}
          welcome={welcome === "1"}
          credits={
            <>
              {credits ? <CreditsCard s={credits} /> : null}
              <BillingCard
                status={billing ? billing.status : undefined}
                notice={billingNotice === "none" || billingNotice === "unavailable" ? billingNotice : undefined}
              />
            </>
          }
          notice={
            askToVerify ? (
              <div className="verify-note">
                <div>
                  <b>Confirm your email</b>
                  <p>
                    We sent a link to {session.user.email}. Open it to confirm your address
                    {credits?.state === "verify_email" ? " and unlock your free theOovi credits" : ""}.
                  </p>
                </div>
                <ResendVerification />
              </div>
            ) : null
          }
        />
      </main>
      <SiteFooter />
    </>
  );
}
