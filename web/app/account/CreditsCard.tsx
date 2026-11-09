import Link from "next/link";
import type { CreditStatus } from "@/lib/credits";

const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });

/** theOovi credits on the account page (server-rendered from creditStatus). */
export function CreditsCard({ s }: { s: CreditStatus }) {
  const share = s.dailyLimit > 0 ? Math.min(1, s.dailyUsed / s.dailyLimit) : 0;
  // The pilot is invite-only unless it's listed publicly in the console.
  const canApply = s.pilot.public && s.pilot.eligible && s.pilot.status === null;
  return (
    <section className="card credits-card" aria-labelledby="credits-title">
      <h2 id="credits-title">{s.displayName} credits</h2>
      {s.message && s.state !== "ok" && (
        <p className={`alert ${s.state === "daily_limit" ? "alert-ok" : "alert-error"}`} role="status" style={{ marginBottom: 14 }}>
          {s.message}
        </p>
      )}
      <div className="credits-stats">
        <div>
          <span className="credits-label">Balance</span>
          <span className="credits-value">{fmt(s.balance)}</span>
          <span className="fine">credits</span>
        </div>
        <div>
          <span className="credits-label">Plan</span>
          <span className="credits-value">{s.plan.name}</span>
          <span className="fine">{s.planUntil ? `Until ${dateFmt.format(new Date(s.planUntil))}` : " "}</span>
        </div>
      </div>
      <div className="credits-today">
        <div className="credits-today-head">
          <span className="credits-label">Daily safety limit</span>
          <span>
            <b>{fmt(s.dailyUsed)}</b> {s.dailyLimit > 0 ? `of ${fmt(s.dailyLimit)} credits` : "credits (no daily limit)"}
          </span>
        </div>
        {s.dailyLimit > 0 && (
          <div
            className="meter"
            role="progressbar"
            aria-label="Credits used today"
            aria-valuemin={0}
            aria-valuemax={s.dailyLimit}
            aria-valuenow={Math.min(s.dailyUsed, s.dailyLimit)}
          >
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        )}
        <span className="fine">A generous cap that protects your credits from a runaway task. Resets at 00:00 UTC.</span>
      </div>
      {s.pilot.status === "pending" && <p className="fine">Your pilot request is being reviewed.</p>}
      {canApply && (
        <p className="muted">
          You joined during the pilot, so you can ask for {fmt(s.pilot.credits)} free credits in exchange for feedback.
        </p>
      )}
      <div className="row-actions" style={{ marginTop: 16 }}>
        <Link href="/pricing" className="btn btn-dark btn-sm">
          Plans and pricing
        </Link>
        {canApply && (
          <Link href="/pilot" className="btn btn-light btn-sm">
            Join the pilot
          </Link>
        )}
        <Link href="/feedback" className="btn btn-ghost btn-sm">
          Send feedback
        </Link>
      </div>
    </section>
  );
}
