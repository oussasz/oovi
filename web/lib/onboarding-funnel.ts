// The desktop app's first run, step by step (app_events, kind "onboarding"), so the owner can see where new
// users stop: started (chose a Chief), reached the team, created a team or skipped to explore.
import { pool } from "./db";

export const FUNNEL_STEPS = ["chief", "team", "created", "alone", "tried", "later"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const isFunnelStep = (x: unknown): x is FunnelStep => typeof x === "string" && (FUNNEL_STEPS as readonly string[]).includes(x);

const ID = /^[a-z0-9-]{1,40}$/;
const ids = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, max) : []);

/** Records one step for a user, once (a second report of the same step is ignored). */
export async function recordStep(userId: string, step: FunnelStep, raw: Record<string, unknown>, platform: string | null, version: string | null): Promise<void> {
  const data = {
    step,
    ...(typeof raw.style === "string" && ID.test(raw.style) ? { style: raw.style } : {}),
    ...(ids(raw.goals, 10).length ? { goals: ids(raw.goals, 10) } : {}),
    ...(ids(raw.setups, 6).length ? { setups: ids(raw.setups, 6) } : {}),
  };
  await pool.query(
    `INSERT INTO app_events (user_id, kind, platform, app_version, data)
     SELECT $1, 'onboarding', $2, $3, $4::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM app_events WHERE user_id = $1 AND kind = 'onboarding' AND data->>'step' = $5)`,
    [userId, platform, version, JSON.stringify(data), step],
  );
}

export type Funnel = { steps: Record<FunnelStep, number>; goals: { id: string; n: number }[]; styles: { id: string; n: number }[] };

/** People who reached each step in the last `days` days, and what they chose most. */
export async function funnel(days: number): Promise<Funnel | null> {
  try {
    const since = `now() - make_interval(days => $1::int)`;
    const [s, g, st] = await Promise.all([
      pool.query<{ step: string; n: string }>(`SELECT data->>'step' AS step, count(DISTINCT user_id) AS n FROM app_events WHERE kind = 'onboarding' AND created_at >= ${since} GROUP BY 1`, [days]),
      pool.query<{ id: string; n: string }>(`SELECT g AS id, count(*) AS n FROM app_events, jsonb_array_elements_text(data->'goals') g WHERE kind = 'onboarding' AND data->>'step' IN ('created', 'alone') AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [days]),
      pool.query<{ id: string; n: string }>(`SELECT data->>'style' AS id, count(*) AS n FROM app_events WHERE kind = 'onboarding' AND data->>'step' = 'chief' AND data ? 'style' AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`, [days]),
    ]);
    const steps = Object.fromEntries(FUNNEL_STEPS.map((k) => [k, Number(s.rows.find((r) => r.step === k)?.n ?? 0)])) as Record<FunnelStep, number>;
    return { steps, goals: g.rows.map((r) => ({ id: r.id, n: Number(r.n) })), styles: st.rows.map((r) => ({ id: r.id, n: Number(r.n) })) };
  } catch (err) {
    console.error("onboarding funnel failed", err instanceof Error ? err.message : err);
    return null;
  }
}
