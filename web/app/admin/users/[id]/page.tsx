import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getUserDetail } from "@/lib/admin-stats";
import { USAGE_COUNT_KEYS } from "@/lib/telemetry";
import { assess, countryLabel, getSignals } from "@/lib/user-signals";
import { isDisposableEmail } from "@/lib/signup-guard";
import { VerdictBadge } from "@/components/admin/Verdict";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtAgo, fmtDate, fmtDateTime, fmtInt, fmtUsd, platformLabel } from "@/components/admin/format";
import { USAGE_LABELS } from "@/components/admin/usage-labels";
import { ActionForm } from "@/components/admin/ActionForm";
import { CreditsPanel } from "./CreditsPanel";
import { markEmailVerifiedAction, resendVerificationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "User" };

const EVENT_LABELS: Record<string, string> = {
  app_open: "Opened the app",
  download: "Downloaded",
};

function eventDetails(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  try {
    const s = JSON.stringify(data);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return "";
  }
}

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!id || id.length > 200) notFound();
  let userId = id;
  try {
    userId = decodeURIComponent(id);
  } catch {
    notFound();
  }
  const detail = await getUserDetail(userId);
  if (!detail) notFound();
  const { user, events, crashes, usage, counts } = detail;
  const signals = (await getSignals([user.id]))?.get(user.id) ?? null;
  const verdict = signals ? assess(user, signals) : null;
  const gap = (a: string | null, b: string | null) => {
    if (!a || !b) return "–";
    const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));
    return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  };
  const viaLabel: Record<string, string> = { web: "The website", app: "The desktop app", api: "Directly through the API (not the app)" };

  return (
    <>
      <PageHead title={user.name || user.email} sub={user.email}>
        <Link href={`/admin/pilot?invite=${encodeURIComponent(user.email)}#invite`} className="btn btn-light btn-sm">
          Send pilot invitation
        </Link>
        <Link href="/admin/users" className="btn btn-ghost btn-sm">
          All users
        </Link>
      </PageHead>

      <CreditsPanel userId={user.id} email={user.email} isSelf={user.id === admin.id} />

      <Section
        title="Account"
        actions={
          <span className={`adm-badge ${user.emailVerified ? "on" : "warn"}`}>{user.emailVerified ? "Email confirmed" : "Email not confirmed"}</span>
        }
      >
        <dl className="adm-dl">
          <dt>Email</dt>
          <dd>
            {user.email} · {user.emailVerified ? "confirmed" : "not confirmed yet"}
          </dd>
          <dt>Name</dt>
          <dd>{user.name || "–"}</dd>
          <dt>Account ID</dt>
          <dd className="adm-mono">{user.id}</dd>
          <dt>Created</dt>
          <dd>{fmtDateTime(user.createdAt)}</dd>
          <dt>Last seen in app</dt>
          <dd>
            {user.lastSeenAt ? `${fmtDateTime(user.lastSeenAt)} (${fmtAgo(user.lastSeenAt)})` : "Never opened the desktop app"}
          </dd>
          <dt>App version</dt>
          <dd className="adm-mono">{user.appVersion ?? "–"}</dd>
          <dt>Platform</dt>
          <dd>{platformLabel(user.platform)}</dd>
          <dt>Terms version</dt>
          <dd>{user.termsVersion ?? "–"}</dd>
          <dt>Recorded</dt>
          <dd>
            {fmtInt(counts.events)} events · {fmtInt(counts.crashes)} crash reports · {fmtInt(counts.usageDays)} days of usage
          </dd>
        </dl>
        {!user.emailVerified && (
          <div className="adm-row-actions" style={{ marginTop: 16 }}>
            <ActionForm
              action={resendVerificationAction}
              submitLabel="Resend confirmation email"
              pendingLabel="Sending…"
              submitClassName="btn btn-light btn-sm"
            >
              <input type="hidden" name="userId" value={user.id} />
            </ActionForm>
            <ActionForm
              action={markEmailVerifiedAction}
              submitLabel="Mark email as confirmed"
              submitClassName="btn btn-ghost btn-sm"
              confirm={`Mark ${user.email} as confirmed without them clicking the link?

Only do this when you know the address belongs to them.`}
            >
              <input type="hidden" name="userId" value={user.id} />
            </ActionForm>
          </div>
        )}
      </Section>

      <Section
        title="Where they come from and how they use theOovi"
        sub="Hints to tell real people from scripts. Nothing here blocks anyone; you decide."
        actions={<VerdictBadge v={verdict} />}
      >
        {!signals ? (
          <Empty>Not available yet. It appears after the next sign-in or theOovi request.</Empty>
        ) : (
          <>
            {verdict && verdict.reasons.length > 0 && (
              <ul className="adm-list" style={{ marginBottom: 16 }}>
                {verdict.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <dl className="adm-dl">
              <dt>Country</dt>
              <dd>
                {countryLabel(signals.lastCountry ?? signals.signupCountry)}
                {signals.signupCountry && signals.lastCountry && signals.signupCountry !== signals.lastCountry
                  ? ` (signed up from ${countryLabel(signals.signupCountry)})`
                  : ""}
              </dd>
              <dt>Signed up through</dt>
              <dd>{signals.signupVia ? (viaLabel[signals.signupVia] ?? signals.signupVia) : "Not recorded (account is older)"}</dd>
              <dt>Came from</dt>
              <dd>{signals.signupRef ?? "–"}</dd>
              <dt>Email</dt>
              <dd>
                {user.email.split("@")[1] ?? "–"}
                {isDisposableEmail(user.email) ? " · temporary email provider" : ""}
                {signals.emailConfirmedAt ? ` · confirmed ${gap(user.createdAt, signals.emailConfirmedAt)} after signing up` : ""}
              </dd>
              <dt>First theOovi request</dt>
              <dd>
                {signals.firstAiAt ? `${fmtDateTime(signals.firstAiAt)} (${gap(user.createdAt, signals.firstAiAt)} after signing up)` : "–"}
              </dd>
              <dt>Latest theOovi request</dt>
              <dd>{signals.lastAiAt ? `${fmtDateTime(signals.lastAiAt)} (${fmtAgo(signals.lastAiAt)})` : "–"}</dd>
              <dt>Requests from the app</dt>
              <dd>{fmtInt(signals.appCalls)}</dd>
              <dt>Requests without the app’s headers</dt>
              <dd>{fmtInt(signals.directCalls)}</dd>
              <dt>Requests that used tools</dt>
              <dd>{fmtInt(signals.toolCalls)}</dd>
              <dt>Credits used</dt>
              <dd>
                {fmtInt(signals.creditsUsed)} over {fmtInt(signals.usageDays)} {signals.usageDays === 1 ? "day" : "days"}
              </dd>
              <dt>Accounts from the same network</dt>
              <dd>{signals.sameNetwork ? `${fmtInt(signals.sameNetwork)} other (last 30 days)` : "None"}</dd>
            </dl>
          </>
        )}
      </Section>

      <Section title="Daily usage" sub="Numbers the desktop app reports once a day (latest 60 days). Never chat content.">
        {usage.length === 0 ? (
          <Empty>No usage reported yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Version</th>
                  {USAGE_COUNT_KEYS.map((k) => (
                    <th key={k} className="num">
                      {USAGE_LABELS[k].short}
                    </th>
                  ))}
                  <th>Bots · groups · connectors · skills</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.day}>
                    <td className="nowrap">{fmtDate(`${u.day}T00:00:00Z`)}</td>
                    <td className="adm-mono">{u.appVersion ?? "–"}</td>
                    {USAGE_COUNT_KEYS.map((k) => (
                      <td key={k} className="num">
                        {k === "costUsd" ? fmtUsd(Number(u.counts[k] ?? 0)) : fmtInt(Number(u.counts[k] ?? 0))}
                      </td>
                    ))}
                    <td className="nowrap">
                      {u.totals
                        ? [u.totals.bots, u.totals.groups, u.totals.connectors, u.totals.skills].map((v) => fmtInt(Number(v ?? 0))).join(" · ")
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="adm-grid-2">
        <Section title="Activity" sub="Latest 100 events">
          {events.length === 0 ? (
            <Empty>No activity recorded yet.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Version</th>
                    <th>Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{fmtDateTime(e.createdAt)}</td>
                      <td>
                        {EVENT_LABELS[e.kind] ?? e.kind}
                        {eventDetails(e.data) && <div className="adm-mono fine">{eventDetails(e.data)}</div>}
                      </td>
                      <td className="adm-mono">{e.appVersion ?? "–"}</td>
                      <td>{platformLabel(e.platform)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Crash reports" sub="Latest 20">
          {crashes.length === 0 ? (
            <Empty>No crashes. Nice.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {crashes.map((c) => (
                <details key={c.id} className="adm-details">
                  <summary>
                    {c.message.length > 140 ? `${c.message.slice(0, 140)}…` : c.message}
                  </summary>
                  <p className="fine" style={{ marginTop: 6 }}>
                    {fmtDateTime(c.createdAt)} · v{c.appVersion} · {platformLabel(c.platform)}
                  </p>
                  {c.stack && <pre className="adm-pre">{c.stack}</pre>}
                  {c.context && <pre className="adm-pre">{c.context}</pre>}
                </details>
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
