import Link from "next/link";

const STATUS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment due: please update your payment method",
  paused: "Paused",
  canceled: "Canceled",
};

/** Paid plan and billing on the account page. "Manage billing" opens the Paddle customer portal. */
export function BillingCard({ status, notice }: { status: string | null | undefined; notice?: "none" | "unavailable" }) {
  const hasBilling = status !== undefined;
  return (
    <section className="card billing-card" aria-labelledby="billing-title">
      <h2 id="billing-title">Billing</h2>
      {notice === "unavailable" && (
        <p className="alert alert-error" role="status">
          Billing management isn’t available right now. Try again later, or write to contact@conuron.com.
        </p>
      )}
      {notice === "none" && (
        <p className="alert alert-error" role="status">
          We couldn’t find a subscription for this account. If you paid with another email, write to contact@conuron.com.
        </p>
      )}
      {hasBilling ? (
        <>
          <p className="muted">
            Subscription: <b>{status ? (STATUS[status] ?? status) : "None"}</b>. Change your payment method, see invoices or
            cancel on Paddle’s secure billing page.
          </p>
          <form action="/api/billing/portal" method="post">
            <button type="submit" className="btn btn-dark btn-md">
              Manage billing
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="muted">You’re on the free plan. Paid plans add theOovi credits every month.</p>
          <Link href="/pricing" className="btn btn-light btn-md">
            See plans
          </Link>
        </>
      )}
      <p className="fine">
        Payments are handled by Paddle. <Link href="/refund">Refund policy</Link>
      </p>
    </section>
  );
}
