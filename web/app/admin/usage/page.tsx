import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getUsage, parsePeriod } from "@/lib/admin-stats";
import { USAGE_COUNT_KEYS } from "@/lib/telemetry";
import { BarChart, LineChart } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtCompact, fmtInt, fmtNumber, fmtUsd } from "@/components/admin/format";
import { TOTAL_LABELS, USAGE_LABELS } from "@/components/admin/usage-labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage" };

export default async function AdminUsage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const u = await getUsage(period);
  const fmt = (k: string, v: number) => (k === "costUsd" ? fmtUsd(v) : fmtCompact(v));
  const perUser = (v: number) => (u.users ? v / u.users : 0);
  const perUserDay = (v: number) => (u.userDays ? v / u.userDays : 0);
  const anyTotals = u.totals.some((t) => t.users > 0);

  return (
    <>
      <PageHead
        title="Usage"
        sub="Daily numbers the desktop app reports (counts only, never chat content). Days are the user's local day as reported."
      >
        <PeriodPicker period={period} path="/admin/usage" />
      </PageHead>

      <div className="adm-kpis">
        <Kpi
          label={`People reporting usage, ${period} days`}
          value={fmtInt(u.users)}
          change={{ value: u.users, previous: u.previousUsers }}
          previousLabel={`the ${period} days before`}
        />
        <Kpi
          label="Messages"
          value={fmtCompact(u.sums.messages)}
          change={{ value: u.sums.messages, previous: u.previous.messages }}
          previousLabel={`the ${period} days before`}
        />
        <Kpi
          label="AI cost (users' own keys)"
          value={fmtUsd(u.sums.costUsd)}
          change={{ value: u.sums.costUsd, previous: u.previous.costUsd }}
          previousLabel={`the ${period} days before`}
        />
        <Kpi label="Messages per active user" value={fmtNumber(perUser(u.sums.messages))} hint={`${fmtNumber(perUserDay(u.sums.messages))} per active day`} />
      </div>

      <div className="adm-grid-2">
        <Section title="Messages">
          <BarChart title={`Messages per day, last ${period} days`} labels={u.days} values={u.perDay.sums.messages} />
        </Section>
        <Section title="AI cost">
          <LineChart
            title={`Cost per day (USD), last ${period} days`}
            labels={u.days}
            values={u.perDay.sums.costUsd}
            color="var(--coral)"
            format={(v) => fmtUsd(v)}
            integer={false}
          />
        </Section>
      </div>

      <Section title="Totals" sub={`Sum over the last ${period} days, with averages per person and per active day`}>
        {u.userDays === 0 ? (
          <Empty>No usage reported in this period yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>What</th>
                  <th className="num">Total</th>
                  <th className="num">Previous period</th>
                  <th className="num">Per active user</th>
                  <th className="num">Per active day</th>
                </tr>
              </thead>
              <tbody>
                {USAGE_COUNT_KEYS.map((k) => (
                  <tr key={k}>
                    <td>{USAGE_LABELS[k].label}</td>
                    <td className="num">{fmt(k, u.sums[k])}</td>
                    <td className="num">{fmt(k, u.previous[k])}</td>
                    <td className="num">{k === "costUsd" ? fmtUsd(perUser(u.sums[k])) : fmtNumber(perUser(u.sums[k]))}</td>
                    <td className="num">{k === "costUsd" ? fmtUsd(perUserDay(u.sums[k])) : fmtNumber(perUserDay(u.sums[k]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine" style={{ marginTop: 10 }}>
              {fmtInt(u.users)} people over {fmtInt(u.userDays)} active days.
            </p>
          </div>
        )}
      </Section>

      <div className="adm-grid-2">
        <Section title="Daily reporting users">
          <BarChart title={`People who reported usage, per day, last ${period} days`} labels={u.days} values={u.perDay.users} color="var(--lilac)" />
        </Section>
        <Section title="Setups" sub="What people have set up, from each person's latest report in the period">
          {!anyTotals ? (
            <Empty>No setup totals reported in this period yet.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Per person</th>
                    <th className="num">Median</th>
                    <th className="num">Average</th>
                    <th className="num">90th pct</th>
                    <th className="num">Max</th>
                    <th className="num">Have none</th>
                  </tr>
                </thead>
                <tbody>
                  {u.totals.map((t) => (
                    <tr key={t.key}>
                      <td>{TOTAL_LABELS[t.key]}</td>
                      <td className="num">{fmtNumber(t.median)}</td>
                      <td className="num">{fmtNumber(t.average)}</td>
                      <td className="num">{fmtNumber(t.p90)}</td>
                      <td className="num">{fmtInt(t.max)}</td>
                      <td className="num">{t.users ? `${Math.round((t.zero / t.users) * 100)}%` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
