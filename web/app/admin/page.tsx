import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getOverview, parsePeriod } from "@/lib/admin-stats";
import { DOWNLOAD_TARGETS } from "@/lib/releases";
import { BarChart, LineChart, SplitBars, StackedBarChart } from "@/components/admin/Charts";
import { Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtInt, fmtPct, platformLabel, TARGET_COLORS, TARGET_LABELS } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  const o = await getOverview(period);

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
        <Kpi label="Crash reports, 7 days" value={fmtInt(o.crashes7.value)} change={o.crashes7} previousLabel="the 7 days before" lowerIsBetter />
      </div>

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
