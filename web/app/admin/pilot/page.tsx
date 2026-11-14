import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getPilotConfig, pilotOpenFor } from "@/lib/ai-config";
import { listPilotRequests, pilotCreditsGranted, PILOT_STATUSES, teamSizeLabel, type PilotStatus } from "@/lib/ai-admin";
import { PilotReview, PilotStatusBadge } from "@/components/admin/PilotReview";
import { ActionForm } from "@/components/admin/ActionForm";
import { isEmail, smtpStatus } from "@/lib/mail";
import { recentInvites } from "@/lib/pilot-invite";
import { sendPilotInvite } from "./actions";
import { Empty, FilterLinks, Kpi, PageHead, Section } from "@/components/admin/ui";
import { fmtDate, fmtDateTime, fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pilot" };

const LABELS: Record<PilotStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export default async function AdminPilot({ searchParams }: { searchParams: Promise<{ status?: string; invite?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = PILOT_STATUSES.includes(sp.status as PilotStatus) ? (sp.status as PilotStatus) : null;
  const [{ rows, counts }, cfg, granted, mail, invites] = await Promise.all([
    listPilotRequests(status),
    getPilotConfig(),
    pilotCreditsGranted(),
    smtpStatus().catch(() => null),
    recentInvites(10),
  ]);
  // "Invite" links from a user's page arrive with the address filled in.
  const prefill = typeof sp.invite === "string" && sp.invite.length <= 300 && isEmail(sp.invite.trim()) ? sp.invite.trim().toLowerCase() : "";
  const total = counts.pending + counts.approved + counts.rejected;
  const open = pilotOpenFor(cfg, new Date()).open;

  return (
    <>
      <PageHead
        title="Pilot program"
        sub={
          <>
            Accounts created from {fmtDate(`${cfg.startsAt}T00:00:00Z`)} to {fmtDate(`${cfg.endsAt}T00:00:00Z`)} can ask for{" "}
            {fmtInt(cfg.credits)} credits and the “{cfg.plan}” plan for {fmtInt(cfg.days)} days.{" "}
            {open ? "The program is open." : "The program is closed right now."}{" "}
            <Link href="/admin/ai" className="text-link">
              Change pilot settings
            </Link>
          </>
        }
      />

      <div className="adm-kpis">
        <Kpi label="Pending" value={fmtInt(counts.pending)} hint="Waiting for a decision" />
        <Kpi label="Approved" value={fmtInt(counts.approved)} hint={`${fmtInt(granted)} credits granted in total`} />
        <Kpi label="Rejected" value={fmtInt(counts.rejected)} />
        <Kpi label="All requests" value={fmtInt(total)} />
      </div>

      <div id="invite">
        <Section
          title="Send the pilot invitation"
          sub="Sends the personal “Thanks for trying oovi” email (the one you used to write by hand) from your own mail server, in oovi's email design. It asks before sending and won't invite the same address twice by accident."
        >
          {mail && !mail.ready && (
            <p className="alert alert-error" role="status">
              Email isn't set up yet, so nothing can be sent. Add the mail server in <Link href="/admin/email" className="text-link">Email</Link> first.
            </p>
          )}
          <ActionForm
            action={sendPilotInvite}
            submitLabel="Send invitation"
            pendingLabel="Sending…"
            confirm="Send the pilot invitation now? The person receives a real email from oovi."
            resetOnSuccess
            extraButtons={
              <a href="/admin/email/preview?t=invite" target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                Preview the email
              </a>
            }
          >
            <div className="adm-fields" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <div className="field">
                <label htmlFor="invite-email">Email address</label>
                <input id="invite-email" name="email" className="input" type="email" required maxLength={300} defaultValue={prefill} placeholder="name@example.com" autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="invite-name">Name for the greeting (optional)</label>
                <input id="invite-name" name="name" className="input" maxLength={80} placeholder="Leave empty to use the account's name" autoComplete="off" />
              </div>
            </div>
            <label className="check">
              <input type="checkbox" name="again" /> Send again, even if this address was already invited
            </label>
          </ActionForm>
          {invites.length > 0 && (
            <div className="adm-table-wrap" style={{ marginTop: 16 }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Invited</th>
                    <th>Sent by</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={`${i.email}-${i.at}`}>
                      <td>
                        {i.email}
                        {i.again && <span className="adm-badge" style={{ marginInlineStart: 8 }}>Sent again</span>}
                      </td>
                      <td>{i.by}</td>
                      <td className="nowrap">{fmtDateTime(i.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section
        title={status ? `${LABELS[status]} requests` : "All requests"}
        sub="Pending first, then newest. Approving adds the credits and starts the pilot plan right away."
        actions={
          <FilterLinks
            label="Filter by status"
            items={[
              { href: "/admin/pilot", text: `All (${fmtInt(total)})`, on: status === null },
              ...PILOT_STATUSES.map((s) => ({ href: `/admin/pilot?status=${s}`, text: `${LABELS[s]} (${fmtInt(counts[s])})`, on: status === s })),
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>{status ? `No ${LABELS[status].toLowerCase()} requests.` : "No pilot requests yet."}</Empty>
        ) : (
          <ul className="adm-list">
            {rows.map((r) => (
              <li key={r.id} className="adm-list-item">
                <div className="adm-list-head">
                  <Link href={`/admin/users/${encodeURIComponent(r.userId)}`} className="adm-strong">
                    {r.email ?? r.userId}
                  </Link>
                  <PilotStatusBadge status={r.status} />
                  <span className="fine">
                    Requested {fmtDateTime(r.createdAt)} · account created {fmtDate(r.userCreatedAt)}
                  </span>
                </div>
                <p className="adm-quote">{r.useCase}</p>
                <dl className="adm-dl adm-dl-inline">
                  <dt>Organization</dt>
                  <dd>{r.organization || "–"}</dd>
                  <dt>Role</dt>
                  <dd>{r.role || "–"}</dd>
                  <dt>Team size</dt>
                  <dd>{teamSizeLabel(r.teamSize)}</dd>
                </dl>
                <PilotReview req={r} defaultCredits={cfg.credits} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
