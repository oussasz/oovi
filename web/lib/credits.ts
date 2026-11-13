// Credits for theOovi (the hosted model). One place for every balance change, so the
// numbers in the app, on the website and in the console always agree.
//
// Amounts are stored in millicredits (1 credit = 1000 mc). Each model call:
//   1. reserve(): atomically checks status, balance, the daily limit and concurrency,
//      and holds an estimate. Two parallel calls can't both spend the last credits.
//   2. settle(): replaces the hold with what the call really cost.
// A hold that is never settled (a crashed function) expires after 10 minutes.
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { getAiConfig, getPilotConfig, pilotOpenFor, planById, type AiConfig, type Prices } from "./ai-config";
import { siteUrl } from "./site";
import { verificationRequired } from "./mail";

export const MC = 1000;
const STALE_HOLD = "interval '10 minutes'";

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export function nextUtcMidnight(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export type AccountRow = {
  user_id: string;
  balance_mc: string;
  plan: string;
  plan_until: Date | null;
  plan_renews_at: Date | null;
  daily_limit_override: number | null;
  ai_enabled: boolean;
  day: string | Date;
  day_used_mc: string;
  held_mc: string;
  inflight: number;
  held_at: Date | null;
  total_used_mc: string;
  created_at: Date;
};

// pg returns DATE columns as a Date at local midnight; read its local parts back as the stored day.
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);

// ---------- money ----------

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** US dollars for one call, at the configured prices (long-context rates above the threshold). */
export function costUsd(u: Usage, p: Prices): number {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const long = p.longAbove > 0 && prompt > p.longAbove && p.input > 0;
  const k = long ? p.longInput / p.input : 1;
  const outRate = long ? p.longOutput : p.output;
  return (u.input * p.input * k + u.cacheRead * p.cacheRead * k + u.cacheWrite * p.cacheWrite * k + u.output * outRate) / 1_000_000;
}

export const usdToMc = (usd: number, cfg: AiConfig) => Math.max(0, Math.ceil(usd * cfg.creditsPerUsd * MC));
export const mcToCredits = (mc: number | string) => Number(mc) / MC;

// ---------- accounts ----------

export function networkHash(ip: string | null): string | null {
  if (!ip || ip === "unknown") return null;
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  return crypto.createHash("sha256").update(`oovi-net:${secret}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * The person's credit account, created on first use with the signup credits.
 * The signup grant is limited per network (a salted hash, never the IP itself).
 */
export async function ensureAccount(userId: string, ip: string | null): Promise<AccountRow> {
  const found = await pool.query<AccountRow>("SELECT * FROM credit_accounts WHERE user_id = $1", [userId]);
  if (found.rows[0]) return syncPlan(found.rows[0]);
  const cfg = await getAiConfig();
  const hash = networkHash(ip);
  let grant = cfg.signupCredits;
  if (grant > 0 && hash && cfg.signupGrantsPerNetwork > 0) {
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM credit_accounts WHERE grant_ip_hash = $1 AND created_at > now() - interval '30 days'",
      [hash],
    );
    if (Number(rows[0]?.n ?? 0) >= cfg.signupGrantsPerNetwork) grant = 0;
  }
  const created = await inTx(async (c) => {
    const ins = await c.query<AccountRow>(
      `INSERT INTO credit_accounts (user_id, balance_mc, grant_ip_hash) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING RETURNING *`,
      [userId, grant * MC, grant > 0 ? hash : null],
    );
    if (ins.rows[0] && cfg.signupCredits > 0) {
      await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note) VALUES ($1, $2, 'signup', $3)", [
        userId,
        grant * MC,
        grant > 0 ? "Welcome credits" : "No welcome credits: too many new accounts from the same network",
      ]);
    }
    return ins.rows[0] ?? null;
  });
  if (created) return created;
  const again = await pool.query<AccountRow>("SELECT * FROM credit_accounts WHERE user_id = $1", [userId]);
  return again.rows[0]!;
}

/** Ends expired plans and adds the monthly credits of active ones. Cheap when nothing is due. */
async function syncPlan(row: AccountRow): Promise<AccountRow> {
  const now = Date.now();
  const expired = row.plan !== "free" && row.plan_until && row.plan_until.getTime() <= now;
  const renew = row.plan !== "free" && row.plan_renews_at && row.plan_renews_at.getTime() <= now;
  if (!expired && !renew) return row;
  try {
    return await inTx(async (c) => {
      const { rows } = await c.query<AccountRow>("SELECT * FROM credit_accounts WHERE user_id = $1 FOR UPDATE", [row.user_id]);
      const r = rows[0]!;
      const until = r.plan_until?.getTime() ?? Infinity;
      let renewsAt = r.plan_renews_at?.getTime() ?? null;
      const plan = await planById(r.plan);
      let added = 0;
      // A monthly top-up only when at least half a month of the plan is left (a 365-day plan gets 12, not 13).
      for (let i = 0; i < 12 && renewsAt !== null && renewsAt <= now && renewsAt + 15 * 86_400_000 <= until; i++) {
        added += plan.monthlyCredits;
        renewsAt += 30 * 86_400_000;
      }
      // No more top-ups fit before the plan ends: stop checking on every request.
      if (renewsAt !== null && renewsAt + 15 * 86_400_000 > until) renewsAt = null;
      if (added > 0) {
        await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note) VALUES ($1, $2, 'plan', $3)", [r.user_id, added * MC, `${plan.name}: monthly credits`]);
      }
      const ends = r.plan !== "free" && until <= now;
      if (ends) await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note) VALUES ($1, 0, 'plan', $2)", [r.user_id, `${plan.name} plan ended`]);
      const upd = await c.query<AccountRow>(
        `UPDATE credit_accounts SET balance_mc = balance_mc + $2, plan = $3, plan_until = $4, plan_renews_at = $5, updated_at = now()
          WHERE user_id = $1 RETURNING *`,
        [r.user_id, added * MC, ends ? "free" : r.plan, ends ? null : r.plan_until, ends || renewsAt === null ? null : new Date(renewsAt)],
      );
      return upd.rows[0]!;
    });
  } catch (err) {
    console.error("plan sync failed", err instanceof Error ? err.message : err);
    return row;
  }
}

export async function dailyLimitFor(row: AccountRow): Promise<number> {
  if (row.daily_limit_override !== null && row.daily_limit_override !== undefined) return row.daily_limit_override;
  return (await planById(row.plan)).dailyLimit;
}

// ---------- status (what the app and the website show) ----------

/** verify_email: free credits wait until the email address is confirmed (console setting). */
export type CreditState = "ok" | "verify_email" | "no_credits" | "daily_limit" | "suspended" | "paused" | "off";

export type CreditStatus = {
  /** "ok" = theOovi can be used now; anything else says why not. */
  state: CreditState;
  message: string | null;
  displayName: string;
  balance: number;
  dailyLimit: number;
  dailyUsed: number;
  resetsAt: string;
  plan: { id: string; name: string };
  planUntil: string | null;
  maxInputTokens: number;
  /** How many model calls this account may have running at once (the app queues the rest). */
  maxConcurrent: number;
  links: { subscribe: string; pricing: string; pilot: string; feedback: string };
  /** public: the pilot may be advertised. When off, only people given the link find it. */
  pilot: { open: boolean; eligible: boolean; public: boolean; status: "pending" | "approved" | "rejected" | null; credits: number };
};

const MSG = {
  suspended: (name: string) => `${name} is turned off for your account. Contact contact@conuron.com if you think this is a mistake. Your own API keys still work.`,
  noCredits: "You've used all your credits. Subscribe for more, or add your own API key.",
  daily: "You've reached today's safety limit, which protects your credits from runaway use. It resets at midnight UTC.",
  verify: "Confirm your email to start using your free credits. We sent you a link; check your inbox (and spam).",
};

export const VERIFY_MESSAGE = MSG.verify;

export async function creditStatus(userId: string, userCreatedAt: Date | string, ip: string | null, emailVerified = true): Promise<CreditStatus> {
  const cfg = await getAiConfig();
  const row = await ensureAccount(userId, ip);
  const plan = await planById(row.plan);
  const limit = await dailyLimitFor(row);
  const usedMc = dayKey(row.day) === utcDay() ? Number(row.day_used_mc) : 0;
  const balance = mcToCredits(row.balance_mc);
  const dailyUsed = mcToCredits(usedMc);
  const pilotCfg = await getPilotConfig();
  const pilotWin = pilotOpenFor(pilotCfg, userCreatedAt);
  const pr = await pool.query<{ status: "pending" | "approved" | "rejected" }>("SELECT status FROM pilot_requests WHERE user_id = $1", [userId]);
  const base = siteUrl();

  let state: CreditState = "ok";
  let message: string | null = null;
  if (!cfg.enabled) {
    state = "off";
    message = `${cfg.displayName} isn't available right now. Add your own API key in Settings > AI models.`;
  } else if (cfg.paused) {
    state = "paused";
    message = cfg.pausedMessage;
  } else if (!row.ai_enabled) {
    state = "suspended";
    message = MSG.suspended(cfg.displayName);
  } else if (!emailVerified && (await verificationRequired())) {
    state = "verify_email";
    message = MSG.verify;
  } else if (balance <= 0) {
    state = "no_credits";
    // Never had any: the welcome grant was skipped (too many new accounts on one network).
    message =
      Number(row.total_used_mc) === 0
        ? "Free credits weren't added to this account because several accounts were created recently on the same network. Subscribe, join the pilot program, or add your own API key."
        : MSG.noCredits;
  } else if (limit > 0 && dailyUsed >= limit) {
    state = "daily_limit";
    message = MSG.daily;
  }

  return {
    state,
    message,
    displayName: cfg.displayName,
    balance: Math.max(0, Math.floor(balance * 10) / 10),
    dailyLimit: limit,
    dailyUsed: Math.ceil(dailyUsed * 10) / 10,
    resetsAt: nextUtcMidnight(),
    plan: { id: plan.id, name: plan.name },
    planUntil: row.plan !== "free" && row.plan_until ? row.plan_until.toISOString() : null,
    maxInputTokens: cfg.maxInputTokens,
    maxConcurrent: cfg.maxConcurrent,
    links: {
      subscribe: cfg.subscribeUrl || `${base}/pricing`,
      pricing: `${base}/pricing`,
      pilot: `${base}/pilot`,
      feedback: `${base}/feedback`,
    },
    pilot: { open: pilotWin.open, eligible: pilotWin.eligible, public: pilotCfg.public, status: pr.rows[0]?.status ?? null, credits: pilotCfg.credits },
  };
}

// ---------- reserve / settle ----------

export type ReserveResult = { ok: true; holdMc: number } | { ok: false; status: number; code: CreditState | "busy"; message: string };

export async function reserve(row: AccountRow, holdMc: number, cfg: AiConfig): Promise<ReserveResult> {
  const today = utcDay();
  const limitMc = (await dailyLimitFor(row)) * MC;
  const { rows } = await pool.query<AccountRow>(
    `WITH cur AS (
       SELECT user_id,
              CASE WHEN held_at IS NULL OR held_at < now() - ${STALE_HOLD} THEN 0 ELSE held_mc END AS held,
              CASE WHEN held_at IS NULL OR held_at < now() - ${STALE_HOLD} THEN 0 ELSE inflight END AS running,
              CASE WHEN day = $2::date THEN day_used_mc ELSE 0 END AS used
         FROM credit_accounts WHERE user_id = $1 FOR UPDATE
     )
     UPDATE credit_accounts a SET
       day = $2::date,
       day_used_mc = cur.used,
       held_mc = cur.held + $3,
       inflight = cur.running + 1,
       held_at = now(),
       updated_at = now()
       FROM cur
      WHERE a.user_id = cur.user_id
        AND a.ai_enabled
        AND a.balance_mc - cur.held > 0
        AND ($4::bigint = 0 OR cur.used + cur.held < $4::bigint)
        AND cur.running < $5
     RETURNING a.user_id`,
    [row.user_id, today, holdMc, limitMc, cfg.maxConcurrent],
  );
  if (rows[0]) return { ok: true, holdMc };

  // Work out which rule stopped it, for a precise message.
  const { rows: cur } = await pool.query<AccountRow>("SELECT * FROM credit_accounts WHERE user_id = $1", [row.user_id]);
  const r = cur[0] ?? row;
  const stale = !r.held_at || r.held_at.getTime() < Date.now() - 10 * 60_000;
  const held = stale ? 0 : Number(r.held_mc);
  const used = dayKey(r.day) === today ? Number(r.day_used_mc) : 0;
  if (!r.ai_enabled) return { ok: false, status: 403, code: "suspended", message: MSG.suspended(cfg.displayName) };
  if (Number(r.balance_mc) - held <= 0) return { ok: false, status: 402, code: "no_credits", message: MSG.noCredits };
  if (limitMc > 0 && used + held >= limitMc) return { ok: false, status: 429, code: "daily_limit", message: MSG.daily };
  return { ok: false, status: 429, code: "busy", message: "Too many requests at once. Wait for the current ones to finish." };
}

export async function settle(userId: string, holdMc: number, usedMc: number): Promise<{ balanceMc: number; dayUsedMc: number }> {
  const today = utcDay();
  const { rows } = await pool.query<{ balance_mc: string; day_used_mc: string }>(
    `UPDATE credit_accounts SET
       held_mc = GREATEST(0, held_mc - $2),
       inflight = GREATEST(0, inflight - 1),
       balance_mc = balance_mc - $3,
       day_used_mc = CASE WHEN day = $4::date THEN day_used_mc ELSE 0 END + $3,
       day = $4::date,
       total_used_mc = total_used_mc + $3,
       updated_at = now()
     WHERE user_id = $1 RETURNING balance_mc, day_used_mc`,
    [userId, holdMc, usedMc, today],
  );
  return { balanceMc: Number(rows[0]?.balance_mc ?? 0), dayUsedMc: Number(rows[0]?.day_used_mc ?? 0) };
}

export type CallRecord = Usage & { costUsd: number; creditsMc: number; latencyMs: number; error?: boolean; blocked?: boolean };

/** Adds one call to today's per-person totals (what the console's KPIs are built from). */
export async function recordCall(userId: string, c: CallRecord): Promise<void> {
  const ok = !c.error && !c.blocked;
  await pool.query(
    `INSERT INTO ai_usage_daily (user_id, day, calls, errors, blocked, input_tokens, output_tokens, cache_read, cache_write, cost_usd, credits_mc, latency_ms)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (user_id, day) DO UPDATE SET
       calls = ai_usage_daily.calls + EXCLUDED.calls,
       errors = ai_usage_daily.errors + EXCLUDED.errors,
       blocked = ai_usage_daily.blocked + EXCLUDED.blocked,
       input_tokens = ai_usage_daily.input_tokens + EXCLUDED.input_tokens,
       output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens,
       cache_read = ai_usage_daily.cache_read + EXCLUDED.cache_read,
       cache_write = ai_usage_daily.cache_write + EXCLUDED.cache_write,
       cost_usd = ai_usage_daily.cost_usd + EXCLUDED.cost_usd,
       credits_mc = ai_usage_daily.credits_mc + EXCLUDED.credits_mc,
       latency_ms = ai_usage_daily.latency_ms + EXCLUDED.latency_ms`,
    [userId, utcDay(), ok ? 1 : 0, c.error ? 1 : 0, c.blocked ? 1 : 0, c.input, c.output, c.cacheRead, c.cacheWrite, c.costUsd.toFixed(6), c.creditsMc, ok ? Math.round(c.latencyMs) : 0],
  );
}

type SpendCache = { usd: number; at: number };
const sg = globalThis as typeof globalThis & { __ooviSpend?: SpendCache };

/** Everyone's model cost today (cached for 20 seconds). */
export async function spendToday(): Promise<number> {
  const c = sg.__ooviSpend;
  if (c && Date.now() - c.at < 20_000) return c.usd;
  const { rows } = await pool.query<{ usd: string | null }>("SELECT sum(cost_usd)::text AS usd FROM ai_usage_daily WHERE day = $1::date", [utcDay()]);
  const usd = Number(rows[0]?.usd ?? 0);
  sg.__ooviSpend = { usd, at: Date.now() };
  return usd;
}

export function bumpSpend(usd: number) {
  if (sg.__ooviSpend) sg.__ooviSpend.usd += usd;
}

// ---------- admin actions (always audited by the caller) ----------

export async function audit(adminEmail: string, action: string, target: string | null, detail?: unknown): Promise<void> {
  await pool.query("INSERT INTO admin_audit (admin_email, action, target, detail) VALUES ($1, $2, $3, $4::jsonb)", [
    adminEmail,
    action,
    target,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}

export async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Adds (or, with a negative amount, removes) credits. */
export async function adjustCredits(userId: string, credits: number, kind: string, note: string, actor: string | null): Promise<void> {
  const mc = Math.round(credits * MC);
  await ensureAccount(userId, null);
  await inTx(async (c) => {
    await c.query("UPDATE credit_accounts SET balance_mc = balance_mc + $2, updated_at = now() WHERE user_id = $1", [userId, mc]);
    await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, $2, $3, $4, $5)", [userId, mc, kind, note.slice(0, 300), actor]);
  });
}

/** Puts someone on a plan for `days` days and adds its first month of credits now. */
export async function setPlan(userId: string, planId: string, days: number, actor: string | null): Promise<void> {
  const plan = await planById(planId);
  await ensureAccount(userId, null);
  await inTx(async (c) => {
    if (plan.id === "free") {
      await c.query("UPDATE credit_accounts SET plan = 'free', plan_until = NULL, plan_renews_at = NULL, updated_at = now() WHERE user_id = $1", [userId]);
      await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, 0, 'plan', 'Moved to Free', $2)", [userId, actor]);
      return;
    }
    const until = new Date(Date.now() + days * 86_400_000);
    const renews = days > 30 ? new Date(Date.now() + 30 * 86_400_000) : null;
    await c.query(
      "UPDATE credit_accounts SET plan = $2, plan_until = $3, plan_renews_at = $4, balance_mc = balance_mc + $5, updated_at = now() WHERE user_id = $1",
      [userId, plan.id, until, renews, plan.monthlyCredits * MC],
    );
    await c.query("INSERT INTO credit_ledger (user_id, delta_mc, kind, note, actor) VALUES ($1, $2, 'plan', $3, $4)", [
      userId,
      plan.monthlyCredits * MC,
      `${plan.name} for ${days} days`,
      actor,
    ]);
  });
}

export async function setAiEnabled(userId: string, enabled: boolean): Promise<void> {
  await ensureAccount(userId, null);
  await pool.query("UPDATE credit_accounts SET ai_enabled = $2, updated_at = now() WHERE user_id = $1", [userId, enabled]);
}

export async function setDailyOverride(userId: string, limit: number | null): Promise<void> {
  await ensureAccount(userId, null);
  await pool.query("UPDATE credit_accounts SET daily_limit_override = $2, updated_at = now() WHERE user_id = $1", [userId, limit]);
}

export async function resetToday(userId: string): Promise<void> {
  await pool.query("UPDATE credit_accounts SET day_used_mc = 0, held_mc = 0, inflight = 0, updated_at = now() WHERE user_id = $1", [userId]);
}

/** Blocking signs the person out everywhere and stops new sign-ins. */
export async function setBlocked(userId: string, blocked: boolean, reason: string | null): Promise<void> {
  await inTx(async (c) => {
    await c.query('UPDATE "user" SET oovi_status = $2, oovi_status_reason = $3 WHERE id = $1', [userId, blocked ? "blocked" : "active", blocked ? reason : null]);
    if (blocked) await c.query('DELETE FROM "session" WHERE "userId" = $1', [userId]);
  });
}

export async function isBlocked(userId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oovi_status: string }>('SELECT oovi_status FROM "user" WHERE id = $1', [userId]);
    return rows[0]?.oovi_status === "blocked";
  } catch {
    // Column missing until the migration runs: nobody is blocked yet.
    return false;
  }
}
