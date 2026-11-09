import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getDownloads, parsePeriod } from "@/lib/admin-stats";
import { DOWNLOAD_TARGETS, githubDownloadCounts } from "@/lib/releases";
import { StackedBarChart } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { countryName, fmtInt, TARGET_COLORS, TARGET_LABELS } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Downloads" };

export default async function AdminDownloads({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const [d, gh] = await Promise.all([getDownloads(period), githubDownloadCounts()]);

  return (
    <>
      <PageHead
        title="Downloads"
        sub="Clicks on the download buttons that led to an installer. Link previews and bots are not counted. No IP addresses are stored."
      >
        <PeriodPicker period={period} path="/admin/downloads" />
      </PageHead>

      <div className="adm-kpis">
        <Kpi
          label={`Downloads, last ${period} days`}
          value={fmtInt(d.periodTotal)}
          change={{ value: d.periodTotal, previous: d.previousTotal }}
          previousLabel={`the ${period} days before`}
        />
        {DOWNLOAD_TARGETS.map((t) => (
          <Kpi
            key={t}
            label={TARGET_LABELS[t] ?? t}
            value={fmtInt(d.periodByTarget[t])}
            hint={`${d.periodTotal ? Math.round((d.periodByTarget[t] / d.periodTotal) * 100) : 0}% of this period · ${fmtInt(d.allTimeByTarget[t])} all time`}
          />
        ))}
        <Kpi label="All time (site)" value={fmtInt(d.allTime)} hint="Since the site started counting download clicks" />
        {gh && (
          <Kpi
            label="Installers downloaded, all time (GitHub)"
            value={fmtInt(gh.total)}
            hint={DOWNLOAD_TARGETS.map((t) => `${TARGET_LABELS[t] ?? t} ${fmtInt(gh.byTarget[t])}`).join(" · ")}
          />
        )}
      </div>

      {gh && (
        <Section title="By version" sub="Installer downloads per release, as counted by GitHub. Includes downloads from before the site started counting.">
          {gh.byVersion.length === 0 ? (
            <Empty>No releases yet.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Released</th>
                    <th className="num">Total</th>
                    {DOWNLOAD_TARGETS.map((t) => (
                      <th key={t} className="num">
                        {TARGET_LABELS[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gh.byVersion.map((v) => (
                    <tr key={v.tag}>
                      <td>{v.tag}</td>
                      <td className="nowrap">{v.publishedAt ? new Date(v.publishedAt).toISOString().slice(0, 10) : "–"}</td>
                      <td className="num">{fmtInt(v.total)}</td>
                      {DOWNLOAD_TARGETS.map((t) => (
                        <td key={t} className="num">
                          {fmtInt(v.byTarget[t])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="Per day">
        <StackedBarChart
          title={`Downloads per day by platform, last ${period} days`}
          labels={d.days}
          series={DOWNLOAD_TARGETS.map((t) => ({ name: TARGET_LABELS[t] ?? t, color: TARGET_COLORS[t] ?? "var(--muted)", values: d.perDay[t] }))}
        />
      </Section>

      <Section title="By country" sub={`Last ${period} days, from the hosting provider's country header`}>
        {d.countries.length === 0 ? (
          <Empty>No downloads in this period yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="num">Total</th>
                  <th className="num">Share</th>
                  {DOWNLOAD_TARGETS.map((t) => (
                    <th key={t} className="num">
                      {TARGET_LABELS[t]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.countries.map((c) => (
                  <tr key={c.country || "unknown"}>
                    <td>
                      {countryName(c.country)}
                      {c.country && <span className="fine"> {c.country}</span>}
                    </td>
                    <td className="num">{fmtInt(c.total)}</td>
                    <td className="num">{d.periodTotal ? `${Math.round((c.total / d.periodTotal) * 100)}%` : "–"}</td>
                    {DOWNLOAD_TARGETS.map((t) => (
                      <td key={t} className="num">
                        {fmtInt(c.byTarget[t])}
                      </td>
                    ))}
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
