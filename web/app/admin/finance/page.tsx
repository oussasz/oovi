import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { parsePeriod } from "@/lib/admin-stats";
import { getFinance } from "@/lib/finance";
import { ActionForm } from "@/components/admin/ActionForm";
import { BarChart, LineChart, SplitBars } from "@/components/admin/Charts";
import { Empty, Kpi, PageHead, PeriodPicker, Section } from "@/components/admin/ui";
import { fmtDate, fmtInt, fmtNumber, fmtPct, fmtUsd } from "@/components/admin/format";
import { saveFinanceAction } from "./actions";
import { CostsEditor } from "./CostsEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Finance" };

const usdDec = (v: number) => fmtUsd(Math.round(v * 100) / 100);
const was = (v: number, label: string) => `${label}: ${usdDec(v)}`;
const ADJUSTMENT = { refund: "Refund", chargeback: "Chargeback", chargeback_reverse: "Chargeback won back", credit: "Credit", credit_reverse: "Credit reversed", chargeback_warning: "Chargeback warning" } as Record<string, string>;

export default async function AdminFinance({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).period);
  let f: Awaited<ReturnType<typeof getFinance>>;
  try {
    f = await getFinance(period);
  } catch (err) {
    // 42P01: the finance tables don't exist yet (database setup not run since this page was added).
    if ((err as { code?: string }).code !== "42P01") throw err;
    return (
      <>
        <PageHead title="Finance" />
        <p className="alert alert-error" role="status">
          The finance tables aren’t in the database yet. Run the database setup (<code>npm run db:migrate</code> in the web folder) once, then reload
          this page. Payments still give credits meanwhile; Paddle re-sends them until they can be recorded here.
        </p>
      </>
    );
  }
  const c = f.current;
  const p = f.previous;
  const r = f.recurring;
  const b = f.burn;
  const prevLabel = `the ${period} days before`;
  const refundRate = c.gross > 0 ? c.refunds / c.gross : null;
  const feeRate = c.gross > 0 ? c.fees / c.gross : null;
  const noData = f.recentPayments.length === 0;

  return (
    <>
      <PageHead
        title="Finance"
        sub="Money from Paddle (in USD, what reaches your Paddle balance), recorded from every payment, refund and chargeback Paddle reports. Revenue is before tax; Paddle collects and pays the tax."
      >
        <PeriodPicker period={period} path="/admin/finance" />
      </PageHead>

      {noData && (
        <p className="alert alert-ok" role="status" style={{ marginBottom: 18 }}>
          No payments yet. Numbers appear here as soon as Paddle reports the first one (live checkout opens once Paddle approves your account).
        </p>
      )}

      <Section title="Recurring revenue" sub="Subscriptions that pay right now, at the price of their latest payment. Yearly plans count 1/12 of their price per month.">
        <div className="adm-kpis">
          <Kpi label="MRR (monthly recurring revenue)" value={usdDec(r.mrr)} hint={`${usdDec(r.netMrr)} after Paddle fees`} />
          <Kpi label="ARR (annual run rate)" value={usdDec(r.arr)} hint="MRR × 12" />
          <Kpi label="Paying customers" value={fmtInt(r.payingCustomers)} hint={`${fmtInt(r.activeSubscriptions)} active subscriptions`} />
          <Kpi label="ARPU (per paying customer)" value={usdDec(r.arpu)} hint={`${usdDec(r.arpuAllAccounts)} per account, all ${fmtInt(r.accounts)} accounts`} />
          <Kpi label={`New subscriptions, ${period} days`} value={fmtInt(r.newSubscriptions)} />
          <Kpi label={`Churn, ${period} days`} value={fmtPct(r.churn)} hint={`${fmtInt(r.canceledSubscriptions)} canceled`} lowerIsBetter />
        </div>
        <div className="adm-grid-2" style={{ marginTop: 16 }}>
          <SplitBars title="MRR by plan" rows={r.byPlan} format={usdDec} empty="No paying subscriptions yet." />
        </div>
      </Section>

      <Section title={`Revenue, last ${period} days`} sub="Gross = what customers paid before tax. Net = what you keep after Paddle's fee, refunds and chargebacks.">
        <div className="adm-kpis">
          <Kpi label="Gross revenue" value={usdDec(c.gross)} change={{ value: c.payments, previous: p.payments }} previousLabel={prevLabel} hint={was(p.gross, "Before")} />
          <Kpi label="Paddle fees" value={usdDec(c.fees)} hint={feeRate === null ? "No payments yet" : `${fmtPct(feeRate)} of gross`} />
          <Kpi label="Net revenue" value={usdDec(c.net)} hint={was(p.net, "Before")} />
          <Kpi label="Refunds" value={usdDec(c.refunds)} hint={`${fmtInt(c.refundCount)} refunds · ${refundRate === null ? "–" : fmtPct(refundRate)} of gross`} />
          <Kpi label="Chargebacks" value={usdDec(c.chargebacks)} hint={`${fmtInt(c.chargebackCount)} chargebacks · ${usdDec(c.chargebackFees)} in fees`} />
          <Kpi label="Tax collected by Paddle" value={usdDec(c.tax)} hint="Paid to tax offices by Paddle, not yours" />
        </div>
        <div className="adm-grid-2" style={{ marginTop: 16 }}>
          <BarChart title="Gross revenue per day" labels={f.days} values={f.perDay.gross} format={usdDec} integer={false} />
          <LineChart title="Earnings per day (after Paddle fees)" labels={f.days} values={f.perDay.net} format={usdDec} integer={false} color="var(--coral)" />
        </div>
      </Section>

      <Section
        title="Burn rate & runway"
        sub="Monthly costs = your fixed costs below + what theOovi cost in AI over the last 30 days. Net burn = monthly costs minus net revenue of the last 30 days."
      >
        <div className="adm-kpis">
          <Kpi label="Monthly costs (gross burn)" value={usdDec(b.grossBurn)} hint={`${usdDec(b.fixedCosts)} fixed + ${usdDec(b.aiCost)} theOovi AI`} />
          <Kpi label="Net revenue, last 30 days" value={usdDec(f.last30.net)} hint={`${usdDec(f.last30.gross)} gross, ${usdDec(f.last30.fees)} Paddle fees`} />
          <Kpi
            label={b.netBurn > 0 ? "Net burn per month" : "Monthly profit"}
            value={usdDec(Math.abs(b.netBurn))}
            hint={b.netBurn > 0 ? "Spending more than you earn" : "Earning at least what you spend"}
          />
          <Kpi
            label="Runway"
            value={b.runwayMonths === null ? (b.netBurn > 0 ? "–" : "Not burning") : `${fmtNumber(b.runwayMonths)} months`}
            hint={
              b.cashUsd > 0
                ? `${usdDec(b.cashUsd)} cash${b.cashAsOf ? ` on ${fmtDate(`${b.cashAsOf}T00:00:00Z`)}` : ""}`
                : "Enter your cash below to see the runway"
            }
          />
        </div>

        <ActionForm action={saveFinanceAction} submitLabel="Save cash and costs">
          <fieldset className="adm-fieldset">
            <legend>Cash</legend>
            <div className="adm-fields">
              <div className="field">
                <label htmlFor="cashUsd">Cash in the bank (USD)</label>
                <input id="cashUsd" name="cashUsd" className="input" type="number" min={0} step="any" defaultValue={b.cashUsd || ""} placeholder="e.g. 12000" />
              </div>
              <div className="field">
                <label htmlFor="cashAsOf">On this date</label>
                <input id="cashAsOf" name="cashAsOf" className="input" type="date" defaultValue={b.cashAsOf ?? ""} />
              </div>
            </div>
          </fieldset>
          <fieldset className="adm-fieldset">
            <legend>Fixed monthly costs</legend>
            <p className="adm-sub">Hosting, database, email, domains, tools, salaries… theOovi AI costs are added automatically. Paddle fees are already taken out of net revenue.</p>
            <CostsEditor initial={f.settings.costs} />
          </fieldset>
        </ActionForm>
      </Section>

      <Section title="Latest payments" sub="Charged = what the customer paid, in their currency, tax included. Gross, fee and earnings in USD.">
        {f.recentPayments.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Charged</th>
                  <th>Gross</th>
                  <th>Paddle fee</th>
                  <th>Earnings</th>
                </tr>
              </thead>
              <tbody>
                {f.recentPayments.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDate(x.at)}</td>
                    <td>{x.email ?? "–"}</td>
                    <td>
                      {x.plan ? `${x.plan.replace(/^\w/, (s) => s.toUpperCase())}${x.interval ? ` (${x.interval === "year" ? "yearly" : "monthly"})` : ""}` : "–"}
                      {x.refunded && <span className="pill" style={{ marginLeft: 6 }}>Refunded</span>}
                    </td>
                    <td>
                      {x.charged.toLocaleString("en-US", { maximumFractionDigits: 2 })} {x.currency}
                    </td>
                    <td>{usdDec(x.gross)}</td>
                    <td>{usdDec(x.fee)}</td>
                    <td>{usdDec(x.earnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Refunds & chargebacks" sub="The latest ones, with Paddle's status. Only approved ones count in the numbers above.">
        {f.recentAdjustments.length === 0 ? (
          <Empty>None so far.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Amount (USD)</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {f.recentAdjustments.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDate(x.at)}</td>
                    <td>
                      {ADJUSTMENT[x.action] ?? x.action}
                      {x.type === "partial" ? " (partial)" : ""}
                    </td>
                    <td>{x.email ?? "–"}</td>
                    <td>{usdDec(x.amount)}</td>
                    <td>{x.status.replace(/_/g, " ")}</td>
                    <td>{x.reason ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {f.otherCurrencyPayments > 0 && (
        <p className="adm-sub">{fmtInt(f.otherCurrencyPayments)} payments were paid out in another currency and aren’t in these totals.</p>
      )}
    </>
  );
}
