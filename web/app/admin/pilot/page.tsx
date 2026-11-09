import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getPilotConfig, pilotOpenFor } from "@/lib/ai-config";
import { listPilotRequests, pilotCreditsGranted, PILOT_STATUSES, teamSizeLabel, type PilotStatus } from "@/lib/ai-admin";
import { PilotReview, PilotStatusBadge } from "@/components/admin/PilotReview";
import { Empty, FilterLinks, Kpi, PageHead, Section } from "@/components/admin/ui";
import { fmtDate, fmtDateTime, fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pilot" };

const LABELS: Record<PilotStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

export default async function AdminPilot({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = PILOT_STATUSES.includes(sp.status as PilotStatus) ? (sp.status as PilotStatus) : null;
  const [{ rows, counts }, cfg, granted] = await Promise.all([listPilotRequests(status), getPilotConfig(), pilotCreditsGranted()]);
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
