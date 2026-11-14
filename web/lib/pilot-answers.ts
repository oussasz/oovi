// Server side of the pilot form answers: the column that holds them (created on first use, also in
// scripts/migrate.mjs) and the summary shown on Admin > Pilot. Never breaks a pilot request: if the column
// can't be created the request is saved without the answers.
import { pool } from "./db";
import { HEARD, IMPROVE, MOBILE, PAY, PAY_METHODS, ROLES, SYSTEMS, USES, labelOf, readAnswers, type PilotAnswers } from "./pilot-form";

const g = globalThis as typeof globalThis & { __ooviPilotCol?: { ok: boolean; at: number; run?: Promise<boolean> } };

/** Makes sure pilot_requests.answers exists. Once per server (again after a minute if it failed); gives up fast on a locked table. */
export async function ensurePilotAnswers(): Promise<boolean> {
  const s = (g.__ooviPilotCol ??= { ok: false, at: 0 });
  if (s.ok) return true;
  if (s.run) return s.run;
  if (s.at && Date.now() - s.at < 60_000) return false;
  s.run = (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("ALTER TABLE pilot_requests ADD COLUMN IF NOT EXISTS answers JSONB NULL");
      await c.query("COMMIT");
      s.ok = true;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      console.error("pilot answers column not ready:", err instanceof Error ? err.message : err);
      s.ok = false;
    } finally {
      c.release();
      s.at = Date.now();
      s.run = undefined;
    }
    return s.ok;
  })();
  return s.run;
}

export type Tally = { label: string; value: number }[];
export type PilotInsights = {
  answered: number;
  avgExperience: number | null;
  avgUsefulness: number | null;
  system: Tally;
  roles: Tally;
  uses: Tally;
  heard: Tally;
  improve: Tally;
  pay: Tally;
  payMethods: Tally;
  mobile: Tally;
  /** People who said yes or maybe to a call. */
  callOk: number;
};

function tally(counts: Map<string, number>, options: { value: string; label: string }[]): Tally {
  return options.map((o) => ({ label: o.label, value: counts.get(o.value) ?? 0 })).filter((t) => t.value > 0).sort((a, b) => b.value - a.value);
}
const bump = (m: Map<string, number>, k: string | undefined) => {
  if (k) m.set(k, (m.get(k) ?? 0) + 1);
};

/** What the people who answered told you, counted. Null when there is nothing to show yet. */
export async function pilotInsights(): Promise<PilotInsights | null> {
  let rows: { answers: unknown }[];
  try {
    ({ rows } = await pool.query("SELECT answers FROM pilot_requests WHERE answers IS NOT NULL ORDER BY created_at DESC LIMIT 5000"));
  } catch {
    return null; // the column isn't there yet
  }
  const list = rows.map((r) => readAnswers(r.answers)).filter((a): a is PilotAnswers => !!a && !!a.role);
  if (!list.length) return null;
  const m = { system: new Map<string, number>(), role: new Map<string, number>(), uses: new Map<string, number>(), heard: new Map<string, number>(), improve: new Map<string, number>(), pay: new Map<string, number>(), payM: new Map<string, number>(), mobile: new Map<string, number>() };
  let exp = 0, expN = 0, use = 0, useN = 0, callOk = 0;
  for (const a of list) {
    bump(m.system, a.system); bump(m.role, a.role); bump(m.heard, a.heard); bump(m.pay, a.pay); bump(m.mobile, a.mobile);
    a.uses.forEach((v) => bump(m.uses, v)); a.improve.forEach((v) => bump(m.improve, v)); a.payMethods.forEach((v) => bump(m.payM, v));
    if (a.experience) { exp += a.experience; expN++; }
    if (a.usefulness) { use += a.usefulness; useN++; }
    if (a.call === "yes" || a.call === "later") callOk++;
  }
  return {
    answered: list.length,
    avgExperience: expN ? exp / expN : null,
    avgUsefulness: useN ? use / useN : null,
    system: tally(m.system, SYSTEMS), roles: tally(m.role, ROLES), uses: tally(m.uses, USES), heard: tally(m.heard, HEARD), improve: tally(m.improve, IMPROVE),
    pay: tally(m.pay, PAY), payMethods: tally(m.payM, PAY_METHODS), mobile: tally(m.mobile, MOBILE), callOk,
  };
}

export { labelOf };
