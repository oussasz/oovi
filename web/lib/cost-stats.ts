// Operating costs, split by who pays:
//  - theOovi (your model): exact, recorded by the server for every call. You pay this.
//  - Own API keys: what people pay their own AI providers, reported once a day by the
//    app (only from people who share usage statistics). From app 0.8.1 on these numbers
//    exclude theOovi calls, so the two never overlap.
// Read-only. Every caller must have passed requireAdmin() first.
import { pool } from "./db";
import { MC } from "./credits";
import { dayKeys, windowStart } from "./admin-stats";

const DAY_MS = 86_400_000;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export type CostSide = {
  costUsd: number;
  prevCostUsd: number;
  users: number;
  prevUsers: number;
  /** theOovi: successful calls. Own keys: bot replies. */
  calls: number;
  tokensIn: number;
  tokensOut: number;
  perDay: number[];
};

export type OperatingCosts = {
  days: string[];
  hosted: CostSide & { credits: number };
  own: CostSide;
  topOwn: { userId: string; email: string; costUsd: number; replies: number }[];
};

export async function getOperatingCosts(period: number): Promise<OperatingCosts | null> {
  const days = dayKeys(period);
  const start = ymd(windowStart(period));
  const prevStart = ymd(new Date(windowStart(period).getTime() - period * DAY_MS));
  const ownCost = "COALESCE((counts->>'costUsd')::numeric, 0)";
  const ownIn = "COALESCE((counts->>'tokensIn')::numeric, 0)";
  try {
    const [hCur, hPrev, hDay, oCur, oPrev, oDay, top] = await Promise.all([
      pool.query(
        `SELECT sum(cost_usd) AS cost, sum(credits_mc) AS mc, sum(calls) AS calls,
                sum(input_tokens + cache_read + cache_write) AS tin, sum(output_tokens) AS tout,
                count(DISTINCT user_id) FILTER (WHERE calls > 0) AS users
           FROM ai_usage_daily WHERE day >= $1::date`,
        [start],
      ),
      pool.query(
        `SELECT sum(cost_usd) AS cost, count(DISTINCT user_id) FILTER (WHERE calls > 0) AS users
           FROM ai_usage_daily WHERE day >= $1::date AND day < $2::date`,
        [prevStart, start],
      ),
      pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS d, sum(cost_usd) AS v FROM ai_usage_daily WHERE day >= $1::date GROUP BY 1`, [start]),
      pool.query(
        `SELECT sum(${ownCost}) AS cost, sum(${ownIn}) AS tin, sum(COALESCE((counts->>'tokensOut')::numeric, 0)) AS tout,
                sum(COALESCE((counts->>'botReplies')::numeric, 0)) AS replies,
                count(DISTINCT user_id) FILTER (WHERE ${ownIn} > 0) AS users
           FROM usage_daily WHERE day >= $1::date`,
        [start],
      ),
      pool.query(
        `SELECT sum(${ownCost}) AS cost, count(DISTINCT user_id) FILTER (WHERE ${ownIn} > 0) AS users
           FROM usage_daily WHERE day >= $1::date AND day < $2::date`,
        [prevStart, start],
      ),
      pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS d, sum(${ownCost}) AS v FROM usage_daily WHERE day >= $1::date GROUP BY 1`, [start]),
      pool.query(
        `SELECT u.user_id, usr.email, sum(COALESCE((u.counts->>'costUsd')::numeric, 0)) AS cost,
                sum(COALESCE((u.counts->>'botReplies')::numeric, 0)) AS replies
           FROM usage_daily u JOIN "user" usr ON usr.id = u.user_id
          WHERE u.day >= $1::date
          GROUP BY u.user_id, usr.email
         HAVING sum(COALESCE((u.counts->>'costUsd')::numeric, 0)) > 0
          ORDER BY cost DESC LIMIT 10`,
        [start],
      ),
    ]);
    const fill = (rows: { d: string; v: unknown }[]) => {
      const m = new Map(rows.map((r) => [r.d, n(r.v)]));
      return days.map((d) => m.get(d) ?? 0);
    };
    const h = hCur.rows[0] ?? {};
    const o = oCur.rows[0] ?? {};
    return {
      days,
      hosted: {
        costUsd: n(h.cost),
        prevCostUsd: n(hPrev.rows[0]?.cost),
        users: n(h.users),
        prevUsers: n(hPrev.rows[0]?.users),
        calls: n(h.calls),
        tokensIn: n(h.tin),
        tokensOut: n(h.tout),
        credits: n(h.mc) / MC,
        perDay: fill(hDay.rows),
      },
      own: {
        costUsd: n(o.cost),
        prevCostUsd: n(oPrev.rows[0]?.cost),
        users: n(o.users),
        prevUsers: n(oPrev.rows[0]?.users),
        calls: n(o.replies),
        tokensIn: n(o.tin),
        tokensOut: n(o.tout),
        perDay: fill(oDay.rows),
      },
      topOwn: top.rows.map((r) => ({ userId: r.user_id, email: r.email, costUsd: n(r.cost), replies: n(r.replies) })),
    };
  } catch (err) {
    // theOovi tables missing (migration not run): the section explains instead of failing the page.
    console.error("operating costs failed", err instanceof Error ? err.message : err);
    return null;
  }
}
