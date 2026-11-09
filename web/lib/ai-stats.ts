// Read-only numbers for theOovi (the hosted model) in the admin console.
// Every caller must have passed requireAdmin() first. All days are UTC.
import { pool } from "./db";
import { MC, utcDay } from "./credits";
import { dayKeys, windowStart } from "./admin-stats";

/** Today / last 7 days / last 30 days, kept in the URL (?period=). */
export const AI_PERIODS = [1, 7, 30] as const;
export type AiPeriod = (typeof AI_PERIODS)[number];
export const AI_PERIOD_LABELS: Record<AiPeriod, string> = { 1: "Today", 7: "7 days", 30: "30 days" };

export function parseAiPeriod(v: string | string[] | undefined): AiPeriod {
  const x = Number(Array.isArray(v) ? v[0] : v);
  return (AI_PERIODS as readonly number[]).includes(x) ? (x as AiPeriod) : 7;
}

const DAY_MS = 86_400_000;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export type AiTotals = {
  costUsd: number;
  credits: number;
  calls: number;
  errors: number;
  blocked: number;
  activeUsers: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AiTopUser = {
  userId: string;
  email: string | null;
  costUsd: number;
  credits: number;
  calls: number;
  errors: number;
  blocked: number;
};

export type AiStats = {
  period: AiPeriod;
  current: AiTotals;
  previous: AiTotals;
  /** Average latency of successful calls (ms), null without calls. */
  avgLatencyMs: number | null;
  /** cache_read / (input + cache_read + cache_write), null without prompt tokens. */
  cacheHitRatio: number | null;
  costPerActiveUser: number | null;
  todayCostUsd: number;
  /** Sum of positive balances: credits people hold and can still spend. */
  outstandingCredits: number;
  accountsWithBalance: number;
  chart: { days: string[]; cost: number[]; calls: number[] };
  topUsers: AiTopUser[];
};

function toTotals(r: Record<string, unknown> | undefined, suffix: "" | "_prev"): AiTotals {
  const g = (k: string) => n(r?.[`${k}${suffix}`]);
  return {
    costUsd: g("cost"),
    credits: g("credits_mc") / MC,
    calls: g("calls"),
    errors: g("errors"),
    blocked: g("blocked"),
    activeUsers: g("users"),
    latencyMs: g("latency"),
    inputTokens: g("input"),
    outputTokens: g("output"),
    cacheRead: g("cache_read"),
    cacheWrite: g("cache_write"),
  };
}

const totalsCols = (cond: string, suffix: string) => `
  COALESCE(sum(cost_usd) FILTER (WHERE ${cond}), 0)::float8 AS cost${suffix},
  COALESCE(sum(credits_mc) FILTER (WHERE ${cond}), 0)::float8 AS credits_mc${suffix},
  COALESCE(sum(calls) FILTER (WHERE ${cond}), 0)::float8 AS calls${suffix},
  COALESCE(sum(errors) FILTER (WHERE ${cond}), 0)::float8 AS errors${suffix},
  COALESCE(sum(blocked) FILTER (WHERE ${cond}), 0)::float8 AS blocked${suffix},
  count(DISTINCT user_id) FILTER (WHERE ${cond} AND calls > 0) AS users${suffix},
  COALESCE(sum(latency_ms) FILTER (WHERE ${cond}), 0)::float8 AS latency${suffix},
  COALESCE(sum(input_tokens) FILTER (WHERE ${cond}), 0)::float8 AS input${suffix},
  COALESCE(sum(output_tokens) FILTER (WHERE ${cond}), 0)::float8 AS output${suffix},
  COALESCE(sum(cache_read) FILTER (WHERE ${cond}), 0)::float8 AS cache_read${suffix},
  COALESCE(sum(cache_write) FILTER (WHERE ${cond}), 0)::float8 AS cache_write${suffix}`;

export async function getAiStats(period: AiPeriod): Promise<AiStats> {
  const start = windowStart(period);
  const prevStart = new Date(start.getTime() - period * DAY_MS);
  // A one-day chart says little, so "Today" still charts the last 7 days.
  const chartDays = Math.max(7, period);
  const days = dayKeys(chartDays);
  const startKey = dateKey(start);

  const [totals, perDay, top, liability, today] = await Promise.all([
    pool.query(
      `SELECT ${totalsCols("day >= $1::date", "")},
              ${totalsCols("day < $1::date", "_prev")}
         FROM ai_usage_daily WHERE day >= $2::date`,
      [startKey, dateKey(prevStart)],
    ),
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS d, sum(cost_usd)::float8 AS cost, sum(calls)::float8 AS calls
         FROM ai_usage_daily WHERE day >= $1::date GROUP BY 1`,
      [days[0]],
    ),
    pool.query(
      `SELECT a.user_id, u.email,
              sum(a.cost_usd)::float8 AS cost, sum(a.credits_mc)::float8 AS credits_mc,
              sum(a.calls)::float8 AS calls, sum(a.errors)::float8 AS errors, sum(a.blocked)::float8 AS blocked
         FROM ai_usage_daily a LEFT JOIN "user" u ON u.id = a.user_id
        WHERE a.day >= $1::date
        GROUP BY a.user_id, u.email
        HAVING sum(a.cost_usd) > 0 OR sum(a.calls) > 0
        ORDER BY sum(a.cost_usd) DESC, sum(a.calls) DESC
        LIMIT 20`,
      [startKey],
    ),
    pool.query(
      `SELECT COALESCE(sum(balance_mc) FILTER (WHERE balance_mc > 0), 0)::float8 AS mc,
              count(*) FILTER (WHERE balance_mc > 0) AS accounts
         FROM credit_accounts`,
    ),
    pool.query(`SELECT COALESCE(sum(cost_usd), 0)::float8 AS usd FROM ai_usage_daily WHERE day = $1::date`, [utcDay()]),
  ]);

  const t = totals.rows[0] as Record<string, unknown> | undefined;
  const current = toTotals(t, "");
  const previous = toTotals(t, "_prev");
  const prompt = current.inputTokens + current.cacheRead + current.cacheWrite;
  const byDay = new Map(perDay.rows.map((r) => [String(r.d), r]));

  return {
    period,
    current,
    previous,
    avgLatencyMs: current.calls > 0 ? current.latencyMs / current.calls : null,
    cacheHitRatio: prompt > 0 ? current.cacheRead / prompt : null,
    costPerActiveUser: current.activeUsers > 0 ? current.costUsd / current.activeUsers : null,
    todayCostUsd: n(today.rows[0]?.usd),
    outstandingCredits: n(liability.rows[0]?.mc) / MC,
    accountsWithBalance: n(liability.rows[0]?.accounts),
    chart: {
      days,
      cost: days.map((d) => n(byDay.get(d)?.cost)),
      calls: days.map((d) => n(byDay.get(d)?.calls)),
    },
    topUsers: top.rows.map((r) => ({
      userId: String(r.user_id),
      email: (r.email as string | null) ?? null,
      costUsd: n(r.cost),
      credits: n(r.credits_mc) / MC,
      calls: n(r.calls),
      errors: n(r.errors),
      blocked: n(r.blocked),
    })),
  };
}

export type AiToday = {
  costUsd: number;
  credits: number;
  users: number;
  pendingPilot: number;
  newFeedback: number;
};

/** The theOovi row on the Overview page. Null when the tables don't exist yet (migration not run). */
export async function getAiToday(): Promise<AiToday | null> {
  try {
    const { rows } = await pool.query(
      `SELECT (SELECT COALESCE(sum(cost_usd), 0)::float8 FROM ai_usage_daily WHERE day = $1::date) AS cost,
              (SELECT COALESCE(sum(credits_mc), 0)::float8 FROM ai_usage_daily WHERE day = $1::date) AS credits_mc,
              (SELECT count(DISTINCT user_id) FROM ai_usage_daily WHERE day = $1::date AND calls > 0) AS users,
              (SELECT count(*) FROM pilot_requests WHERE status = 'pending') AS pending,
              (SELECT count(*) FROM feedback WHERE status = 'new') AS new_feedback`,
      [utcDay()],
    );
    const r = rows[0] ?? {};
    return {
      costUsd: n(r.cost),
      credits: n(r.credits_mc) / MC,
      users: n(r.users),
      pendingPilot: n(r.pending),
      newFeedback: n(r.new_feedback),
    };
  } catch (err) {
    console.error("theOovi overview failed", err instanceof Error ? err.message : err);
    return null;
  }
}
