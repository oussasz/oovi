import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getCrashes, parsePeriod } from "@/lib/admin-stats";
import { BarChart } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtAgo, fmtDate, fmtInt, platformLabel } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Crashes" };

export default async function AdminCrashes({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const c = await getCrashes(period);

  return (
    <>
      <PageHead title="Crashes" sub="Crash reports sent by the desktop app, grouped by error message.">
        <PeriodPicker period={period} path="/admin/crashes" />
      </PageHead>

      <div className="adm-kpis">
        <Kpi
          label={`Crash reports, last ${period} days`}
          value={fmtInt(c.total)}
          change={{ value: c.total, previous: c.previous }}
          previousLabel={`the ${period} days before`}
          lowerIsBetter
        />
        <Kpi label="Signed-in users affected" value={fmtInt(c.affectedUsers)} hint="Reports sent while signed out aren't linked to anyone" />
        <Kpi label="Different errors" value={fmtInt(c.groups.length)} hint={c.groups.length >= 20 ? "Showing the top 20" : undefined} />
      </div>

      <Section title="Per day">
        <BarChart title={`Crash reports per day, last ${period} days`} labels={c.days} values={c.perDay} color="var(--coral)" />
      </Section>

      <Section title="Top errors" sub={`The 20 most frequent messages in the last ${period} days`}>
        {c.groups.length === 0 ? (
          <Empty>No crash reports in this period.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Error</th>
                  <th className="num">Reports</th>
                  <th className="num">Users</th>
                  <th>Versions</th>
                  <th>Platforms</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {c.groups.map((g) => (
                  <tr key={g.hash}>
                    <td style={{ maxWidth: 460 }}>
                      <Link href={`/admin/crashes/${g.hash}`} className="adm-mono" style={{ overflowWrap: "anywhere" }}>
                        {g.message.length > 180 ? `${g.message.slice(0, 180)}…` : g.message}
                      </Link>
                    </td>
                    <td className="num">{fmtInt(g.count)}</td>
                    <td className="num">{fmtInt(g.users)}</td>
                    <td>
                      <span className="adm-chips">
                        {g.versions.slice(0, 6).map((v) => (
                          <span key={v} className="adm-badge adm-mono">
                            {v}
                          </span>
                        ))}
                        {g.versions.length > 6 && <span className="fine">+{g.versions.length - 6}</span>}
                      </span>
                    </td>
                    <td>{g.platforms.map(platformLabel).join(", ")}</td>
                    <td className="nowrap">{fmtDate(g.firstSeen)}</td>
                    <td className="nowrap">{fmtAgo(g.lastSeen)}</td>
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
