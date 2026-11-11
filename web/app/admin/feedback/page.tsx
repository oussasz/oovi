import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { FEEDBACK_FROM, FEEDBACK_KINDS, FEEDBACK_STATUSES, listFeedback, type FeedbackFrom, type FeedbackKind, type FeedbackStatus } from "@/lib/ai-admin";
import { FEEDBACK_KIND_LABELS, FEEDBACK_STATUS_LABELS, FeedbackItem } from "@/components/admin/FeedbackItem";
import { Empty, FilterLinks, Kpi, PageHead, Section } from "@/components/admin/ui";
import { fmtInt } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback" };

function href(status: FeedbackStatus | null, kind: FeedbackKind | null, from: FeedbackFrom | null = null) {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  if (kind) p.set("kind", kind);
  if (from) p.set("from", from);
  const s = p.toString();
  return `/admin/feedback${s ? `?${s}` : ""}`;
}

export default async function AdminFeedback({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; from?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = FEEDBACK_STATUSES.includes(sp.status as FeedbackStatus) ? (sp.status as FeedbackStatus) : null;
  const kind = FEEDBACK_KINDS.includes(sp.kind as FeedbackKind) ? (sp.kind as FeedbackKind) : null;
  const from = FEEDBACK_FROM.includes(sp.from as FeedbackFrom) ? (sp.from as FeedbackFrom) : null;
  const { rows, counts, kinds, bots } = await listFeedback(status, kind, from);
  const total = counts.new + counts.reviewed + counts.done;

  return (
    <>
      <PageHead title="Feedback" sub="Problems and ideas people sent from the desktop app and the website, and notes the bots sent about oovi's own tools. New items first." />

      <div className="adm-kpis">
        <Kpi label="New" value={fmtInt(counts.new)} hint="Not looked at yet" />
        <Kpi label="Reviewed" value={fmtInt(counts.reviewed)} />
        <Kpi label="Done" value={fmtInt(counts.done)} />
        <Kpi label="Problems reported" value={fmtInt(kinds.problem)} hint={`${fmtInt(kinds.improvement)} improvements · ${fmtInt(kinds.other)} other`} />
        <Kpi label="Tool notes from bots" value={fmtInt(bots.total)} hint={`${fmtInt(bots.fresh)} new: which oovi tool failed, and where`} />
      </div>

      <Section
        title="Messages"
        sub={`Showing ${fmtInt(rows.length)} of ${fmtInt(total)} (latest 300 that match).`}
        actions={
          <div className="adm-filters">
            <FilterLinks
              label="Filter by status"
              items={[
                { href: href(null, kind, from), text: "Any status", on: status === null },
                ...FEEDBACK_STATUSES.map((s) => ({ href: href(s, kind, from), text: `${FEEDBACK_STATUS_LABELS[s]} (${fmtInt(counts[s])})`, on: status === s })),
              ]}
            />
            <FilterLinks
              label="Filter by type"
              items={[
                { href: href(status, null, from), text: "Any type", on: kind === null },
                ...FEEDBACK_KINDS.map((k) => ({ href: href(status, k, from), text: FEEDBACK_KIND_LABELS[k], on: kind === k })),
              ]}
            />
            <FilterLinks
              label="Filter by sender"
              items={[
                { href: href(status, kind, null), text: "Anyone", on: from === null },
                { href: href(status, kind, "people"), text: "People", on: from === "people" },
                { href: href(status, kind, "bots"), text: `Bots: tool notes (${fmtInt(bots.total)})`, on: from === "bots" },
              ]}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty>{status || kind || from ? "Nothing matches these filters." : "No feedback yet."}</Empty>
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
