import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { getAiConfig, getPlans } from "@/lib/ai-config";
import { AI_PERIOD_LABELS, AI_PERIODS, getAiStats, type AiPeriod } from "@/lib/ai-stats";
import { BarChart, SplitBars } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtInt, fmtUsd } from "@/components/admin/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costs" };

/** Money with cents; very small amounts keep more digits so they never show as $0.00. */
const usd = (v: number) => (v !== 0 && Math.abs(v) < 0.1 ? `$${v.toPrecision(2)}` : fmtUsd(Math.round(v * 100) / 100));

function parsePeriod(v: string | undefined): AiPeriod {
  const x = Number(v);
  return (AI_PERIODS as readonly number[]).includes(x) ? (x as AiPeriod) : 30;
}

/** A price typed in the what-if form: a number of dollars, 0 or more. */
function price(v: string | undefined, fallback: number): number {
  const x = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(x) && x >= 0 ? x : fallback;
}

export default async function AdminCosts({ searchParams }: { searchParams: Promise<{ period?: string; in?: string; out?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const period = parsePeriod(q.period);
  const [cfg, plans, s] = await Promise.all([getAiConfig(), getPlans(), getAiStats(period)]);
  const c = s.current;
  const pr = cfg.prices;
  const periodName = period === 1 ? "today" : `the last ${period} days`;

  // What 1,000 credits really cost: money spent divided by credits handed out for it.
  const per1000 = c.credits > 0 ? (c.costUsd / c.credits) * 1000 : 1000 / cfg.creditsPerUsd;
  const perMessage = c.calls > 0 ? c.costUsd / c.calls : null;
  const perDayAvg = c.costUsd / period;

  // Where the money goes, by kind of work (list prices x tokens).
  const parts = [
    { label: "Reading what people write", value: (c.inputTokens / 1e6) * pr.input },
    { label: "Writing the answers", value: (c.outputTokens / 1e6) * pr.output },
    { label: "Remembered context (cheap)", value: (c.cacheRead / 1e6) * pr.cacheRead },
    { label: "Saving context for later", value: (c.cacheWrite / 1e6) * pr.cacheWrite },
  ];
  const estimate = parts.reduce((a, p) => a + p.value, 0);

  // What if the model cost less? Prices are typed in; cache prices move in the same proportion as reading.
  const newIn = price(q.in, pr.input);
  const newOut = price(q.out, pr.output);
  const inScale = pr.input > 0 ? newIn / pr.input : 0;
  const newEstimate =
    (c.inputTokens / 1e6) * newIn +
    (c.outputTokens / 1e6) * newOut +
    (c.cacheRead / 1e6) * pr.cacheRead * inScale +
    (c.cacheWrite / 1e6) * pr.cacheWrite * inScale;
  const whatIfCost = estimate > 0 ? c.costUsd * (newEstimate / estimate) : null;
  const changed = newIn !== pr.input || newOut !== pr.output;

  // Plans: what a customer pays, and the most they can cost if they spend every credit.
  const planRows = plans
    .map((p) => {
      const paid = Number(/\$\s*([\d.]+)/.exec(p.price)?.[1] ?? NaN);
      return { name: p.name, paid, worst: p.monthlyCredits / cfg.creditsPerUsd, credits: p.monthlyCredits };
    })
    .filter((p) => Number.isFinite(p.paid) && p.paid > 0 && p.credits > 0);

  const topUsers = s.topUsers.filter((u) => u.costUsd > 0).slice(0, 8);

  return (
    <>
      <PageHead title="Costs" sub="What the AI costs you while people test. Plain numbers, in US dollars, taken from the database.">
        <PeriodPicker period={period} path="/admin/costs" periods={AI_PERIODS} label={(x) => AI_PERIOD_LABELS[x as AiPeriod]} />
      </PageHead>

      <Section title={`You spent ${usd(c.costUsd)} on AI ${periodName}`} sub={`${fmtInt(c.calls)} answers for ${fmtInt(c.activeUsers)} ${c.activeUsers === 1 ? "person" : "people"}.`}>
        <div className="adm-kpis">
          <Kpi
            label="Total spent"
            value={usd(c.costUsd)}
            hint={period === 1 ? undefined : `about ${usd(perDayAvg)} a day`}
            change={{ value: c.costUsd, previous: s.previous.costUsd }}
            previousLabel={period === 1 ? "yesterday" : `the ${period} days before`}
            lowerIsBetter
          />
          <Kpi
            label="1,000 credits cost you"
            value={usd(per1000)}
            hint={c.credits > 0 ? `${fmtInt(c.credits)} credits were used ${periodName}` : "No credits used yet; this is the set price"}
          />
          <Kpi label="One answer costs you" value={perMessage === null ? "–" : usd(perMessage)} hint="average" />
          <Kpi label="One person costs you" value={s.costPerActiveUser === null ? "–" : usd(s.costPerActiveUser)} hint={`over ${periodName}`} />
          <Kpi label="A new free account can cost" value={usd(cfg.signupCredits / cfg.creditsPerUsd)} hint={`${fmtInt(cfg.signupCredits)} starting credits, if all spent`} />
          <Kpi
            label="Credits people still hold"
            value={usd(s.outstandingCredits / cfg.creditsPerUsd)}
            hint={`${fmtInt(s.outstandingCredits)} credits in ${fmtInt(s.accountsWithBalance)} accounts: the most you could still pay`}
          />
        </div>
      </Section>

      <Section title="Spending day by day">
        <BarChart title="Dollars spent per day" labels={s.chart.days} values={s.chart.cost} format={usd} integer={false} color="var(--coral)" />
      </Section>

      <div className="adm-grid-2">
        <Section title="Where the money goes" sub="Which kind of work costs the most.">
          <SplitBars title="Share of the bill" rows={parts} format={usd} color="var(--coral)" empty="No usage yet." />
        </Section>
        <Section title="Who spends the most" sub="Your testers, highest first.">
          {topUsers.length === 0 ? (
            <Empty>No usage yet.</Empty>
          ) : (
            <SplitBars title="Spent per person" rows={topUsers.map((u) => ({ label: u.email ?? u.userId.slice(0, 8), value: u.costUsd }))} format={usd} />
          )}
        </Section>
      </div>

      <Section title="Do the plans make money?" sub="Worst case: the customer spends every credit of the month. The bar is the part of the price that goes to the AI.">
        {planRows.length === 0 ? (
          <Empty>No paid plans with a price yet.</Empty>
        ) : (
          <ul className="split">
            {planRows.map((p) => {
              const keep = p.paid - p.worst;
              return (
                <li key={p.name}>
                  <span className="split-label">{p.name}</span>
                  <span className="split-track" aria-hidden>
                    <span className="split-bar" style={{ width: `${Math.min(100, (p.worst / p.paid) * 100)}%`, background: "var(--coral)" }} />
                  </span>
                  <span className="split-value">
                    pays {usd(p.paid)} · costs up to {usd(p.worst)} · {keep >= 0 ? `you keep ${usd(keep)}` : `you lose ${usd(-keep)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="adm-sub">Paddle’s fee and tax are not included; see Finance.</p>
      </Section>

      <Section
        title="What if the model was cheaper?"
        sub={`You now pay ${usd(pr.input)} to read and ${usd(pr.output)} to write, per million tokens (pieces of words), with ${cfg.model}. Type cheaper prices to see what ${periodName} would have cost.`}
      >
        <form method="get" className="adm-fields">
          <input type="hidden" name="period" value={period} />
          <div className="field">
            <label htmlFor="in">Reading price ($ per million)</label>
            <input id="in" name="in" className="input" type="number" min={0} step="any" defaultValue={newIn} />
          </div>
          <div className="field">
            <label htmlFor="out">Writing price ($ per million)</label>
            <input id="out" name="out" className="input" type="number" min={0} step="any" defaultValue={newOut} />
          </div>
          <div className="field">
            <button className="btn btn-dark btn-sm" type="submit">
              Show me
            </button>
          </div>
        </form>
        {whatIfCost === null ? (
          <Empty>Needs some usage first.</Empty>
        ) : (
          <div className="adm-kpis" style={{ marginTop: 16 }}>
            <Kpi label="Cost now" value={usd(c.costUsd)} />
            <Kpi
              label="Cost with these prices"
              value={usd(whatIfCost)}
              hint={changed ? `${Math.round((1 - whatIfCost / Math.max(c.costUsd, 1e-9)) * 100)}% less` : "same as now"}
            />
            <Kpi label="1,000 credits would cost" value={usd(c.credits > 0 ? (whatIfCost / c.credits) * 1000 : per1000)} hint="if credits stay the same" />
          </div>
        )}
        <p className="adm-sub">
          To really switch, change the model and its prices in the theOovi settings. Check a new model’s prices on Anthropic’s pricing page before typing them here.
          Extra charges for very long conversations are counted as they were.
        </p>
      </Section>
    </>
  );
}
