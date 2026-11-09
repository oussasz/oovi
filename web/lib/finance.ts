// Admin > Finance: revenue, recurring revenue, Paddle fees, refunds and chargebacks, burn and
// runway. Computed from what Paddle reported in verified webhooks (paddle_payments,
// paddle_adjustments, subscriptions) and the AI costs the server records (ai_usage_daily).
// Amounts are in the payout currency (what reaches the Paddle balance: USD for this account),
// stored in cents and returned in dollars.
// Read-only except saveFinanceSettings. Every caller must have passed requireAdmin() first.
import { pool } from "./db";
import { dayKeys, windowStart } from "./admin-stats";

const DAY_MS = 86_400_000;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const usd = (cents: unknown) => n(cents) / 100;

// ---------- settings typed in by the admin ----------

export type FinanceSettings = {
  /** Money in the bank, in USD, on cashAsOf. */
  cashUsd: number;
  cashAsOf: string | null;
  /** Fixed monthly costs (hosting, database, email, tools...). theOovi AI costs are counted automatically. */
  costs: { name: string; usd: number }[];
};

export const DEFAULT_FINANCE: FinanceSettings = { cashUsd: 0, cashAsOf: null, costs: [] };

export function normalizeFinance(raw: unknown): FinanceSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cash = Number(r.cashUsd);
  const asOf = typeof r.cashAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.cashAsOf) ? r.cashAsOf : null;
  const costs = (Array.isArray(r.costs) ? r.costs : [])
    .slice(0, 30)
    .map((x) => {
      const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { name: String(c.name ?? "").trim().slice(0, 60), usd: Number(c.usd) };
    })
    .filter((c) => c.name && Number.isFinite(c.usd) && c.usd >= 0 && c.usd <= 10_000_000);
  return { cashUsd: Number.isFinite(cash) && cash >= 0 && cash <= 1e10 ? cash : 0, cashAsOf: asOf, costs };
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'finance'");
    return normalizeFinance(rows[0]?.value);
  } catch {
    return DEFAULT_FINANCE;
  }
}

export async function saveFinanceSettings(v: FinanceSettings, by: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('finance', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(normalizeFinance(v)), by],
  );
}

// ---------- the numbers ----------

type Money = { gross: number; tax: number; fees: number; earnings: number; payments: number };
type Adjust = { refunds: number; refundCount: number; chargebacks: number; chargebackCount: number; chargebackFees: number; reversedEarnings: number };

export type Finance = {
  period: number;
  days: string[];
  /** Sales before tax and fees, this period and the one before. */
  current: Money & Adjust & { net: number };
  previous: Money & Adjust & { net: number };
  perDay: { gross: number[]; net: number[] };
  recurring: {
    mrr: number;
    arr: number;
    /** MRR after Paddle's fees. */
    netMrr: number;
    payingCustomers: number;
    activeSubscriptions: number;
    /** MRR per paying customer. */
    arpu: number;
    /** MRR per oovi account (free accounts included). */
    arpuAllAccounts: number;
    accounts: number;
    byPlan: { label: string; value: number }[];
    newSubscriptions: number;
    canceledSubscriptions: number;
    /** Canceled in the period / subscriptions at the start of it. Null when there's nothing to compare. */
    churn: number | null;
  };
  last30: { gross: number; net: number; fees: number; aiCost: number };
  burn: {
    fixedCosts: number;
    aiCost: number;
    /** All monthly costs (fixed + theOovi AI cost over the last 30 days). Paddle fees are already out of net revenue. */
    grossBurn: number;
    /** Monthly costs minus net revenue of the last 30 days. Negative: oovi makes more than it spends. */
    netBurn: number;
    cashUsd: number;
    cashAsOf: string | null;
    /** Months the cash lasts at this net burn. Null when not burning (or no cash entered). */
    runwayMonths: number | null;
  };
  settings: FinanceSettings;
  recentPayments: {
    id: string;
    at: string;
    email: string | null;
    plan: string | null;
    interval: string | null;
    currency: string;
    charged: number;
    gross: number;
    fee: number;
    earnings: number;
    refunded: boolean;
  }[];
  recentAdjustments: { id: string; at: string; action: string; type: string | null; status: string; email: string | null; amount: number; reason: string | null }[];
  /** Payments whose payout currency isn't USD (left out of the totals). */
  otherCurrencyPayments: number;
};

async function money(from: Date, to: Date): Promise<Money & Adjust & { net: number }> {
  const [p, a] = await Promise.all([
    pool.query(
      `SELECT sum(payout_subtotal) AS gross, sum(payout_tax) AS tax, sum(payout_fee) AS fees, sum(payout_earnings) AS earnings, count(*) AS payments
         FROM paddle_payments WHERE billed_at >= $1 AND billed_at < $2 AND payout_currency = 'USD'`,
      [from, to],
    ),
    pool.query(
      `SELECT sum(payout_subtotal) FILTER (WHERE action = 'refund') AS refunds,
              count(*) FILTER (WHERE action = 'refund') AS refund_count,
              sum(payout_subtotal) FILTER (WHERE action = 'chargeback') AS chargebacks,
              count(*) FILTER (WHERE action = 'chargeback') AS chargeback_count,
              sum(chargeback_fee) AS chargeback_fees,
              sum(payout_earnings) FILTER (WHERE action IN ('refund', 'chargeback')) AS reversed,
              sum(payout_earnings) FILTER (WHERE action IN ('chargeback_reverse')) AS restored
         FROM paddle_adjustments
        WHERE status = 'approved' AND paddle_created_at >= $1 AND paddle_created_at < $2 AND payout_currency = 'USD'`,
      [from, to],
    ),
  ]);
  const r = p.rows[0] ?? {};
  const x = a.rows[0] ?? {};
  const earnings = usd(r.earnings);
  const reversed = usd(x.reversed) - usd(x.restored);
  const chargebackFees = usd(x.chargeback_fees);
  return {
    gross: usd(r.gross),
    tax: usd(r.tax),
    fees: usd(r.fees),
    earnings,
    payments: n(r.payments),
    refunds: usd(x.refunds),
    refundCount: n(x.refund_count),
    chargebacks: usd(x.chargebacks),
    chargebackCount: n(x.chargeback_count),
    chargebackFees,
    reversedEarnings: reversed,
    net: earnings - reversed - chargebackFees,
  };
}

export async function getFinance(period: number): Promise<Finance> {
  const now = new Date();
  const start = windowStart(period);
  const prevStart = new Date(start.getTime() - period * DAY_MS);
  const days = dayKeys(period);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const settings = await getFinanceSettings();

  const [current, previous, last30m, daily, subs, accounts, subMoves, ai30, other, payments, adjustments] = await Promise.all([
    money(start, now),
    money(prevStart, start),
    money(since30, now),
    pool.query(
      `SELECT to_char(billed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, sum(payout_subtotal) AS gross, sum(payout_earnings) AS earnings
         FROM paddle_payments WHERE billed_at >= $1 AND payout_currency = 'USD' GROUP BY 1`,
      [start],
    ),
    // Recurring revenue: each subscription that currently pays, at the price of its latest payment.
    pool.query(
      `SELECT s.subscription_id, s.customer_id, s.status, s.billing_interval, p.plan_id, p.payout_subtotal, p.payout_earnings
         FROM subscriptions s
         JOIN LATERAL (
           SELECT plan_id, payout_subtotal, payout_earnings FROM paddle_payments pp
            WHERE pp.subscription_id = s.subscription_id AND pp.payout_currency = 'USD'
            ORDER BY billed_at DESC LIMIT 1
         ) p ON true
        WHERE s.status IN ('active', 'past_due')`,
    ),
    pool.query(`SELECT count(*) AS c FROM "user"`),
    pool.query(
      `SELECT count(*) FILTER (WHERE created_at >= $1) AS created,
              count(*) FILTER (WHERE status = 'canceled' AND updated_at >= $1) AS canceled,
              count(*) FILTER (WHERE status IN ('active', 'past_due', 'trialing')) AS live
         FROM subscriptions`,
      [start],
    ),
    pool.query(`SELECT sum(cost_usd) AS cost FROM ai_usage_daily WHERE day >= $1::date`, [since30.toISOString().slice(0, 10)]),
    pool.query(`SELECT count(*) AS c FROM paddle_payments WHERE payout_currency IS DISTINCT FROM 'USD'`),
    pool.query(
      `SELECT p.transaction_id, p.billed_at, p.plan_id, p.billing_interval, p.currency, p.total, p.payout_subtotal, p.payout_fee, p.payout_earnings,
              c.email, EXISTS (SELECT 1 FROM paddle_adjustments a WHERE a.transaction_id = p.transaction_id AND a.action = 'refund' AND a.status = 'approved') AS refunded
         FROM paddle_payments p LEFT JOIN customers c ON c.customer_id = p.customer_id
        ORDER BY p.billed_at DESC LIMIT 15`,
    ),
    pool.query(
      `SELECT a.adjustment_id, a.paddle_created_at, a.action, a.type, a.status, a.payout_total, a.reason, c.email
         FROM paddle_adjustments a LEFT JOIN customers c ON c.customer_id = a.customer_id
        ORDER BY a.paddle_created_at DESC LIMIT 10`,
    ),
  ]);

  // Per day.
  const byDay = new Map(daily.rows.map((r) => [r.d as string, r]));
  const perDay = {
    gross: days.map((d) => usd(byDay.get(d)?.gross)),
    net: days.map((d) => usd(byDay.get(d)?.earnings)),
  };

  // MRR: yearly plans count 1/12 of their price per month.
  let mrr = 0;
  let netMrr = 0;
  const customers = new Set<string>();
  const plans = new Map<string, number>();
  for (const s of subs.rows) {
    const months = s.billing_interval === "year" ? 12 : 1;
    const m = usd(s.payout_subtotal) / months;
    mrr += m;
    netMrr += usd(s.payout_earnings) / months;
    customers.add(s.customer_id);
    const label = s.plan_id ? String(s.plan_id).replace(/^\w/, (c: string) => c.toUpperCase()) : "Other";
    plans.set(label, (plans.get(label) ?? 0) + m);
  }
  const accountCount = n(accounts.rows[0]?.c);
  const moves = subMoves.rows[0] ?? {};
  const created = n(moves.created);
  const canceled = n(moves.canceled);
  const atStart = n(moves.live) + canceled - created;

  const aiCost = n(ai30.rows[0]?.cost);
  const fixedCosts = settings.costs.reduce((t, c) => t + c.usd, 0);
  const grossBurn = fixedCosts + aiCost;
  const netBurn = grossBurn - last30m.net;

  return {
    period,
    days,
    current,
    previous,
    perDay,
    recurring: {
      mrr,
      arr: mrr * 12,
      netMrr,
      payingCustomers: customers.size,
      activeSubscriptions: subs.rows.length,
      arpu: customers.size ? mrr / customers.size : 0,
      arpuAllAccounts: accountCount ? mrr / accountCount : 0,
      accounts: accountCount,
      byPlan: [...plans].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      newSubscriptions: created,
      canceledSubscriptions: canceled,
      churn: atStart > 0 ? canceled / atStart : null,
    },
    last30: { gross: last30m.gross, net: last30m.net, fees: last30m.fees, aiCost },
    burn: {
      fixedCosts,
      aiCost,
      grossBurn,
      netBurn,
      cashUsd: settings.cashUsd,
      cashAsOf: settings.cashAsOf,
      runwayMonths: netBurn > 0 && settings.cashUsd > 0 ? settings.cashUsd / netBurn : null,
    },
    settings,
    recentPayments: payments.rows.map((r) => ({
      id: r.transaction_id,
      at: new Date(r.billed_at).toISOString(),
      email: r.email || null,
      plan: r.plan_id,
      interval: r.billing_interval,
      currency: r.currency,
      charged: n(r.total) / (["JPY", "KRW", "CLP"].includes(r.currency) ? 1 : 100),
      gross: usd(r.payout_subtotal),
      fee: usd(r.payout_fee),
      earnings: usd(r.payout_earnings),
      refunded: !!r.refunded,
    })),
    recentAdjustments: adjustments.rows.map((r) => ({
      id: r.adjustment_id,
      at: new Date(r.paddle_created_at).toISOString(),
      action: r.action,
      type: r.type,
      status: r.status,
      email: r.email || null,
      amount: usd(r.payout_total),
      reason: r.reason,
    })),
    otherCurrencyPayments: n(other.rows[0]?.c),
  };
}
