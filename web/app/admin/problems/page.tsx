import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getProblems, PROBLEM_TAG_LABELS, PROBLEM_TAGS, type ProblemGroup, type ProblemTag } from "@/lib/problems";
import { latestVersion } from "@/lib/update-ask";
import { ActionForm } from "@/components/admin/ActionForm";
import { Empty, FilterLinks, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtAgo, fmtDate, fmtInt, platformLabel } from "@/components/admin/format";
import { markProblemFixed, reopenProblem } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Problems" };

const PERIODS = [7, 30, 90] as const;
const STATES: { key: ProblemGroup["state"]; label: string }[] = [
  { key: "back", label: "Came back" },
  { key: "open", label: "Open" },
  { key: "fixed", label: "Fixed" },
];

function href(period: number, tag: ProblemTag | null, state: ProblemGroup["state"] | null) {
  const p = new URLSearchParams({ period: String(period) });
  if (tag) p.set("tag", tag);
  if (state) p.set("state", state);
  return `/admin/problems?${p}`;
}

function StateBadge({ g }: { g: ProblemGroup }) {
  if (g.state === "back") return <span className="adm-badge warn">Came back in {fmtInt(g.since)} report{g.since === 1 ? "" : "s"}</span>;
  if (g.state === "fixed") return <span className="adm-badge on">Fixed in {g.fixedIn}</span>;
  return <span className="adm-badge">Open</span>;
}

export default async function AdminProblems({ searchParams }: { searchParams: Promise<{ period?: string; tag?: string; state?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const period = (PERIODS as readonly number[]).includes(Number(sp.period)) ? Number(sp.period) : 30;
  const tag = PROBLEM_TAGS.includes(sp.tag as ProblemTag) ? (sp.tag as ProblemTag) : null;
  const state = STATES.some((s) => s.key === sp.state) ? (sp.state as ProblemGroup["state"]) : null;
  const [all, latest] = await Promise.all([getProblems(period, { tag: null, state: null }), latestVersion().catch(() => null)]);
  const groups = all.groups.filter((g) => (!tag || g.tag === tag) && (!state || g.state === state));
  const count = (f: (g: ProblemGroup) => boolean) => all.groups.filter(f).length;

  return (
    <>
      <PageHead
        title="Problems"
        sub="What the desktop app couldn't do for customers: tool errors, tasks that stopped, and tasks a bot couldn't complete. The same problem from many people is one line. Mark it fixed with the version that has the fix: if it's reported again from that version or newer, it shows as Came back and you get one email."
      >
        <PeriodPicker period={period} path="/admin/problems" periods={PERIODS} params={{ ...(tag ? { tag } : {}), ...(state ? { state } : {}) }} />
      </PageHead>

      <div className="adm-kpis">
        <Kpi label="Different problems" value={fmtInt(all.groups.length)} hint={`Last ${period} days`} />
        <Kpi label="Came back after a fix" value={fmtInt(count((g) => g.state === "back"))} />
        <Kpi label="Open" value={fmtInt(count((g) => g.state === "open"))} />
        <Kpi label="People affected" value={fmtInt(all.users)} hint={`${fmtInt(all.reports)} reports`} />
      </div>

      <Section
        title="Problems, most people first"
        sub="Sent only by people who left “Send crash reports and problems” on. Cleaned on their computer: no chats, files, names or full addresses."
        actions={
          <div className="adm-filters">
            <FilterLinks
              label="Filter by state"
              items={[{ href: href(period, tag, null), text: "Any state", on: state === null }, ...STATES.map((s) => ({ href: href(period, tag, s.key), text: s.label, on: state === s.key }))]}
            />
            <FilterLinks
              label="Filter by kind"
              items={[{ href: href(period, null, state), text: "Any kind", on: tag === null }, ...PROBLEM_TAGS.map((t) => ({ href: href(period, t, state), text: PROBLEM_TAG_LABELS[t], on: tag === t }))]}
            />
          </div>
        }
      >
        {groups.length === 0 ? (
          <Empty>{tag || state ? "Nothing matches these filters." : "No problems reported in this period."}</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th className="num">People</th>
                  <th className="num">Reports</th>
                  <th>Versions</th>
                  <th>Seen</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <td style={{ maxWidth: 480 }}>
                      <div style={{ overflowWrap: "anywhere" }}>{g.message}</div>
                      <div className="fine">
                        {PROBLEM_TAG_LABELS[g.tag]}
                        {g.tool ? ` · ${g.tool}` : ""}
                        {g.sites.length ? ` · ${g.sites.join(", ")}` : ""}
                        {g.platforms.length ? ` · ${g.platforms.map(platformLabel).join(", ")}` : ""}
                      </div>
                    </td>
                    <td className="num">{fmtInt(g.users)}</td>
                    <td className="num">{fmtInt(g.count)}</td>
                    <td>
                      <span className="adm-chips">
                        {g.versions.slice(0, 4).map((v) => (
                          <span key={v} className="adm-badge adm-mono">
                            {v}
                          </span>
                        ))}
                        {g.versions.length > 4 && <span className="fine">+{g.versions.length - 4}</span>}
                      </span>
                    </td>
                    <td className="nowrap">
                      {fmtAgo(g.lastSeen)}
                      <div className="fine">first {fmtDate(g.firstSeen)}</div>
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <StateBadge g={g} />
                      <ActionForm action={markProblemFixed} submitLabel={g.fixedIn ? "Change" : "Mark fixed"} submitClassName="btn btn-sm">
                        <input type="hidden" name="key" value={g.key} />
                        <label className="fine" htmlFor={`fix-${g.key}`}>
                          Fixed in version
                        </label>
                        <input id={`fix-${g.key}`} className="input" name="version" defaultValue={g.fixedIn ?? latest ?? ""} placeholder="0.10.14" maxLength={20} style={{ maxWidth: 110 }} />
                      </ActionForm>
                      {g.fixedIn && (
                        <ActionForm action={reopenProblem} submitLabel="Reopen" submitClassName="btn btn-sm">
                          <input type="hidden" name="key" value={g.key} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
