import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, listFeedback, type FeedbackKind, type FeedbackStatus } from "@/lib/ai-admin";
import { FEEDBACK_KIND_LABELS, FEEDBACK_STATUS_LABELS, FeedbackItem } from "@/components/admin/FeedbackItem";
import { Empty, FilterLinks, Kpi, PageHead, Section } from "@/components/admin/ui";
import { fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback" };

function href(status: FeedbackStatus | null, kind: FeedbackKind | null) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (kind) p.set("kind", kind);
  const s = p.toString();
  return `/admin/feedback${s ? `?${s}` : ""}`;
}

export default async function AdminFeedback({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = FEEDBACK_STATUSES.includes(sp.status as FeedbackStatus) ? (sp.status as FeedbackStatus) : null;
  const kind = FEEDBACK_KINDS.includes(sp.kind as FeedbackKind) ? (sp.kind as FeedbackKind) : null;
  const { rows, counts, kinds } = await listFeedback(status, kind);
  const total = counts.new + counts.reviewed + counts.done;

  return (
    <>
      <PageHead title="Feedback" sub="Problems and ideas sent from the desktop app and the website. New items first." />

      <div className="adm-kpis">
        <Kpi label="New" value={fmtInt(counts.new)} hint="Not looked at yet" />
        <Kpi label="Reviewed" value={fmtInt(counts.reviewed)} />
        <Kpi label="Done" value={fmtInt(counts.done)} />
        <Kpi label="Problems reported" value={fmtInt(kinds.problem)} hint={`${fmtInt(kinds.improvement)} improvements · ${fmtInt(kinds.other)} other`} />
      </div>

      <Section
        title="Messages"
        sub={`Showing ${fmtInt(rows.length)} of ${fmtInt(total)} (latest 300 that match).`}
        actions={
          <div className="adm-filters">
            <FilterLinks
              label="Filter by status"
              items={[
                { href: href(null, kind), text: "Any status", on: status === null },
                ...FEEDBACK_STATUSES.map((s) => ({ href: href(s, kind), text: `${FEEDBACK_STATUS_LABELS[s]} (${fmtInt(counts[s])})`, on: status === s })),
              ]}
            />
            <FilterLinks
              label="Filter by type"
              items={[
                { href: href(status, null), text: "Any type", on: kind === null },
                ...FEEDBACK_KINDS.map((k) => ({ href: href(status, k), text: FEEDBACK_KIND_LABELS[k], on: kind === k })),
              ]}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty>{status || kind ? "Nothing matches these filters." : "No feedback yet."}</Empty>
        ) : (
          <ul className="adm-list">
            {rows.map((f) => (
              <FeedbackItem key={f.id} f={f} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
