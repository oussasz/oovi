import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getOverview, parsePeriod } from "@/lib/admin-stats";
import { getAiToday } from "@/lib/ai-stats";
import { getOperatingCosts } from "@/lib/cost-stats";
import { githubDownloadCounts } from "@/lib/releases";
import { DOWNLOAD_TARGETS } from "@/lib/releases";
import { BarChart, LineChart, SplitBars, StackedBarChart } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtInt, fmtNumber, fmtPct, fmtUsd, platformLabel, TARGET_COLORS, TARGET_LABELS } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const [o, gh, ai, costs] = await Promise.all([getOverview(period), githubDownloadCounts(), getAiToday(), getOperatingCosts(period)]);
  const perUser = (cost: number, users: number) => (users ? fmtUsd(cost / users) : "–");

  const stickiness = o.mau.value ? o.dau.value / o.mau.value : null;
  const prevStickiness = o.mau.previous ? (o.dau.previous ?? 0) / o.mau.previous : null;
  const activation = o.totalUsers ? o.activated / o.totalUsers : null;
  const cf = o.crashFree7;
  const crashFree = cf.active ? (cf.active - cf.crashed) / cf.active : null;
  const prevCrashFree = cf.prevActive ? (cf.prevActive - cf.prevCrashed) / cf.prevActive : null;
  const splitText = (by: Record<string, number>) =>
    DOWNLOAD_TARGETS.map((t) => `${TARGET_LABELS[t]} ${fmtInt(by[t] ?? 0)}`).join(" · ");

  return (
    <>
      <PageHead title="Overview" sub="How oovi is doing. All days are in UTC.">
        <PeriodPicker period={period} path="/admin" />
      </PageHead>

      <div className="adm-kpis">
        <Kpi
          label="Accounts"
          value={fmtInt(o.totalUsers)}
          hint={`${fmtInt(o.usersNewInPeriod.value)} new in the last ${period} days`}
        />
        <Kpi label="Sign-ups today" value={fmtInt(o.signupsToday.value)} change={o.signupsToday} previousLabel="yesterday by now" />
        <Kpi label="Sign-ups, last 7 days" value={fmtInt(o.signups7.value)} change={o.signups7} previousLabel="the 7 days before" />
        <Kpi label="Sign-ups, last 30 days" value={fmtInt(o.signups30.value)} change={o.signups30} previousLabel="the 30 days before" />
        <Kpi label="Daily active users" value={fmtInt(o.dau.value)} change={o.dau} previousLabel="the day before" hint="Opened the desktop app in the last 24 hours" />
        <Kpi label="Weekly active users" value={fmtInt(o.wau.value)} change={o.wau} previousLabel="the week before" />
        <Kpi label="Monthly active users" value={fmtInt(o.mau.value)} change={o.mau} previousLabel="the month before" />
        <Kpi
          label="Stickiness (DAU / MAU)"
          value={fmtPct(stickiness)}
          hint={prevStickiness === null ? "How many monthly users come back daily" : `Was ${fmtPct(prevStickiness)} a month ago`}
        />
        <Kpi
          label="Activation"
          value={fmtPct(activation)}
          hint={`${fmtInt(o.activated)} of ${fmtInt(o.totalUsers)} accounts opened the desktop app`}
        />
        <Kpi label="Downloads, last 7 days" value={fmtInt(o.downloads7.value)} change={o.downloads7} previousLabel="the 7 days before" hint={splitText(o.downloadsByTarget7)} />
        <Kpi label="Downloads, last 30 days" value={fmtInt(o.downloads30.value)} change={o.downloads30} previousLabel="the 30 days before" hint={splitText(o.downloadsByTarget30)} />
        <Kpi
          label="Crash-free users, 7 days"
          value={fmtPct(crashFree)}
          hint={
            cf.active
              ? `${fmtInt(cf.crashed)} of ${fmtInt(cf.active)} active users had a crash${prevCrashFree === null ? "" : ` · was ${fmtPct(prevCrashFree)}`}`
              : "No active users this week yet"
          }
        />
        {gh && (
          <Kpi
            label="Installers downloaded, all time"
            value={fmtInt(gh.total)}
            hint={`Counted by GitHub, including before the site started counting · latest ${gh.byVersion[0]?.tag ?? "–"}: ${fmtInt(gh.byVersion[0]?.total ?? 0)}`}
          />
        )}
        <Kpi label="Crash reports, 7 days" value={fmtInt(o.crashes7.value)} change={o.crashes7} previousLabel="the 7 days before" lowerIsBetter />
      </div>

      <Section
        title="Operating costs"
        sub={`What the AI costs over the last ${period} days, split by who pays. theOovi is exact; own keys are reported once a day by the app (people who share usage statistics).`}
      >
        {costs ? (
          <>
            <div className="adm-split">
              <div className="adm-split-col">
                <h3 className="adm-split-h">
                  <span className="adm-swatch" style={{ background: "var(--blue-ink)" }} aria-hidden /> theOovi · your model
                  <span className="adm-split-who">You pay</span>
                </h3>
                <div className="adm-kpis adm-kpis-2">
                  <Kpi
                    label="Model cost"
                    value={fmtUsd(costs.hosted.costUsd)}
                    change={{ value: costs.hosted.costUsd, previous: costs.hosted.prevCostUsd }}
                    previousLabel={`the ${period} days before`}
                    lowerIsBetter
                  />
                  <Kpi label="People using it" value={fmtInt(costs.hosted.users)} change={{ value: costs.hosted.users, previous: costs.hosted.prevUsers }} previousLabel={`the ${period} days before`} />
                  <Kpi label="Cost per person" value={perUser(costs.hosted.costUsd, costs.hosted.users)} hint={`${fmtInt(costs.hosted.calls)} calls · ${fmtNumber(Math.round(costs.hosted.credits))} credits`} />
                  <Kpi label="Tokens" value={fmtNumber(costs.hosted.tokensIn + costs.hosted.tokensOut)} hint={`${fmtNumber(costs.hosted.tokensIn)} in · ${fmtNumber(costs.hosted.tokensOut)} out`} />
                </div>
              </div>
              <div className="adm-split-col">
                <h3 className="adm-split-h">
                  <span className="adm-swatch" style={{ background: "var(--coral)" }} aria-hidden /> Own API keys · their models
                  <span className="adm-split-who">They pay</span>
                </h3>
                <div className="adm-kpis adm-kpis-2">
                  <Kpi label="Their AI cost" value={fmtUsd(costs.own.costUsd)} change={{ value: costs.own.costUsd, previous: costs.own.prevCostUsd }} previousLabel={`the ${period} days before`} />
                  <Kpi label="People using it" value={fmtInt(costs.own.users)} change={{ value: costs.own.users, previous: costs.own.prevUsers }} previousLabel={`the ${period} days before`} />
                  <Kpi label="Cost per person" value={perUser(costs.own.costUsd, costs.own.users)} hint={`${fmtInt(costs.own.calls)} bot replies`} />
                  <Kpi label="Tokens" value={fmtNumber(costs.own.tokensIn + costs.own.tokensOut)} hint={`${fmtNumber(costs.own.tokensIn)} in · ${fmtNumber(costs.own.tokensOut)} out`} />
                </div>
              </div>
            </div>
            <StackedBarChart
              title={`AI cost per day (USD), last ${period} days`}
              labels={costs.days}
              format={fmtUsd}
              series={[
                { name: "theOovi (you pay)", color: "var(--blue-ink)", values: costs.hosted.perDay },
                { name: "Own keys (they pay)", color: "var(--coral)", values: costs.own.perDay },
              ]}
            />
            {costs.topOwn.length > 0 && (
              <div className="adm-table-wrap" style={{ marginTop: 16 }}>
                <table className="adm-table">
                  <caption className="adm-caption">Biggest own-key spenders, last {period} days (theOovi spenders are on the theOovi page)</caption>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Their AI cost</th>
                      <th className="num">Bot replies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.topOwn.map((u) => (
                      <tr key={u.userId}>
                        <td>
                          <Link href={`/admin/users/${encodeURIComponent(u.userId)}`}>{u.email}</Link>
                        </td>
                        <td className="num">{fmtUsd(u.costUsd)}</td>
                        <td className="num">{fmtInt(u.replies)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <Empty>Cost numbers aren’t available yet. Run the database migration (npm run db:migrate).</Empty>
        )}
      </Section>

      <Section
        title="theOovi today"
        sub="The hosted model since 00:00 UTC."
        actions={
          <Link href="/admin/ai" className="btn btn-ghost btn-sm">
            Open theOovi
          </Link>
        }
      >
        {ai ? (
          <div className="adm-kpis">
            <Kpi label="Model cost today" value={fmtUsd(ai.costUsd)} hint={<Link href="/admin/ai?period=1">Costs and settings</Link>} />
            <Kpi label="Credits used today" value={fmtNumber(Math.round(ai.credits * 10) / 10)} />
            <Kpi label="theOovi users today" value={fmtInt(ai.users)} hint="People with at least one successful call" />
            <Kpi
              label="Pending pilot requests"
              value={fmtInt(ai.pendingPilot)}
              hint={<Link href="/admin/pilot?status=pending">Review requests</Link>}
            />
            <Kpi label="New feedback" value={fmtInt(ai.newFeedback)} hint={<Link href="/admin/feedback?status=new">Read feedback</Link>} />
          </div>
        ) : (
          <Empty>theOovi numbers aren’t available yet. Run the database migration (npm run db:migrate) to create its tables.</Empty>
        )}
      </Section>

      <div className="adm-grid-2">
        <Section title="Sign-ups">
          <BarChart title={`New accounts per day, last ${period} days`} labels={o.days} values={o.signupsPerDay} color="var(--blue-ink)" />
        </Section>
        <Section title="Active users">
          <LineChart title={`People who opened the app, per day, last ${period} days`} labels={o.days} values={o.activePerDay} color="var(--coral)" />
        </Section>
      </div>

      <Section title="Downloads">
        <StackedBarChart
          title={`Downloads per day by platform, last ${period} days`}
          labels={o.days}
          series={DOWNLOAD_TARGETS.map((t) => ({ name: TARGET_LABELS[t] ?? t, color: TARGET_COLORS[t] ?? "var(--muted)", values: o.downloadsPerDay[t] }))}
        />
      </Section>

      <div className="adm-grid-2">
        <Section title="Versions in use" sub="Latest app version of people seen in the last 30 days">
          <SplitBars title="App versions" rows={o.versions} empty="No one has opened the desktop app in the last 30 days yet." />
        </Section>
        <Section title="Platforms" sub="Operating system of people seen in the last 30 days">
          <SplitBars
            title="Operating systems"
            rows={o.platforms.map((p) => ({ label: platformLabel(p.label), value: p.value }))}
            color="var(--coral)"
            empty="No one has opened the desktop app in the last 30 days yet."
          />
        </Section>
      </div>
    </>
  );
}
