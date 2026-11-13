// Signals about each account, to tell real people from scripts and to see where they come from.
// Rules: never store IP addresses (only a country code and a salted network hash), never store
// chat content. Everything here is best-effort: recording must never break the request it rides
// on, and the admin pages must keep working when a column isn't there yet.
import { after } from "next/server";
import { pool } from "./db";
import { MC, networkHash } from "./credits";
import { parsePlatform, parseVersion } from "./telemetry";
import { isDisposableEmail } from "./signup-guard";

const emailDomain = (email: string) => email.split("@")[1]?.trim().toLowerCase() ?? "";

// ---------- the columns (created on first use, also in scripts/migrate.mjs) ----------

const COLUMNS: [string, string][] = [
  ["signup_country", "TEXT NULL"],
  ["last_country", "TEXT NULL"],
  ["signup_via", "TEXT NULL"],
  ["signup_ref", "TEXT NULL"],
  ["signup_net", "TEXT NULL"],
  ["first_ai_at", "TIMESTAMPTZ NULL"],
  ["last_ai_at", "TIMESTAMPTZ NULL"],
  ["ai_app_calls", "INT NOT NULL DEFAULT 0"],
  ["ai_direct_calls", "INT NOT NULL DEFAULT 0"],
  ["ai_tool_calls", "INT NOT NULL DEFAULT 0"],
  ["email_verified_at", "TIMESTAMPTZ NULL"],
];

const g = globalThis as typeof globalThis & { __ooviSignalCols?: { ok: boolean; at: number; run?: Promise<boolean> } };

/**
 * Makes sure the columns exist. Runs once per server instance (again after a minute if it failed).
 * Gives up quickly rather than queue behind a long lock, so a busy database can never slow sign-in.
 */
export async function ensureSignalColumns(): Promise<boolean> {
  const s = (g.__ooviSignalCols ??= { ok: false, at: 0 });
  if (s.ok) return true;
  if (s.run) return s.run;
  if (Date.now() - s.at < 60_000 && s.at) return false;
  s.run = (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      for (const [name, type] of COLUMNS) await c.query(`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ${name} ${type}`);
      await c.query("COMMIT");
      s.ok = true;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      console.error("user signal columns not ready:", err instanceof Error ? err.message : err);
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

/** Runs after the response is sent (so the new row is committed); outside a request it just runs. Never throws. */
export function later(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    void fn().catch(() => {});
  }
}

/** The headers of the request a Better Auth hook is running for. */
export function hookHeaders(ctx: { request?: Request | null; headers?: Headers | null } | null | undefined): Headers {
  return ctx?.request?.headers ?? ctx?.headers ?? new Headers();
}

// ---------- small parsers ----------

/** Two-letter country code from Vercel's edge header. */
export function countryOf(h: Headers): string | null {
  const c = h.get("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

function ipOf(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0]!.trim() : h.get("x-real-ip");
}

/** Does this request come from the real desktop app? (It sends its version and OS; a script usually doesn't.) */
export function fromRealApp(h: Headers): { version: string | null; platform: string | null; real: boolean } {
  const version = parseVersion(h.get("x-oovi-version"));
  const platform = parsePlatform(h.get("x-oovi-platform"));
  return { version, platform, real: !!version && !!platform };
}

/** "google.com" or "newsletter:email": where a visitor came from, cleaned and short. */
export function cleanRef(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9.:_\-/ ]/g, "").slice(0, 80);
  return s || null;
}


// ---------- recording ----------

/** A new account: where it came from and how it signed up. `via` = web (the site), app (the desktop app) or api (anything else). */
export async function recordSignup(userId: string, h: Headers, ref: string | null): Promise<void> {
  try {
    if (!(await ensureSignalColumns())) return;
    const country = countryOf(h);
    const via = h.get("x-oovi-via") === "v1" ? (fromRealApp(h).real ? "app" : "api") : "web";
    await pool.query(
      `UPDATE "user" SET signup_country = $2, last_country = COALESCE($2, last_country), signup_via = $3, signup_ref = $4, signup_net = $5
        WHERE id = $1`,
      [userId, country, via, via === "web" ? cleanRef(ref) : null, networkHash(ipOf(h))],
    );
  } catch (err) {
    console.error("signup signals failed:", err instanceof Error ? err.message : err);
  }
}

/** Remember the country of someone who just signed in or opened the app. */
export async function recordCountry(userId: string, h: Headers): Promise<void> {
  try {
    const country = countryOf(h);
    if (!country || !(await ensureSignalColumns())) return;
    await pool.query('UPDATE "user" SET last_country = $2 WHERE id = $1 AND last_country IS DISTINCT FROM $2', [userId, country]);
  } catch (err) {
    console.error("country signal failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * One theOovi request. Counts calls that came from the real app, calls that did not, and calls that
 * used tools; and, when the real app made it, keeps the version, platform and "last seen" fresh.
 */
export async function recordAiCall(userId: string, h: Headers, usedTools: boolean): Promise<void> {
  try {
    if (!(await ensureSignalColumns())) return;
    const app = fromRealApp(h);
    await pool.query(
      `UPDATE "user" SET
          first_ai_at = COALESCE(first_ai_at, now()), last_ai_at = now(),
          last_country = COALESCE($2, last_country),
          last_seen_at = CASE WHEN $3 THEN now() ELSE last_seen_at END,
          last_app_version = CASE WHEN $3 THEN $4 ELSE last_app_version END,
          last_platform = CASE WHEN $3 THEN $5 ELSE last_platform END,
          ai_app_calls = ai_app_calls + CASE WHEN $3 THEN 1 ELSE 0 END,
          ai_direct_calls = ai_direct_calls + CASE WHEN $3 THEN 0 ELSE 1 END,
          ai_tool_calls = ai_tool_calls + CASE WHEN $6 THEN 1 ELSE 0 END
        WHERE id = $1`,
      [userId, countryOf(h), app.real, app.version, app.platform, usedTools],
    );
  } catch (err) {
    console.error("ai call signals failed:", err instanceof Error ? err.message : err);
  }
}

/** The moment an email was confirmed. */
export async function recordEmailConfirmed(userId: string): Promise<void> {
  try {
    if (!(await ensureSignalColumns())) return;
    await pool.query('UPDATE "user" SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
  } catch (err) {
    console.error("email confirmed signal failed:", err instanceof Error ? err.message : err);
  }
}

// ---------- reading, for the admin console ----------

export type Signals = {
  signupCountry: string | null;
  lastCountry: string | null;
  signupVia: string | null;
  signupRef: string | null;
  firstAiAt: string | null;
  lastAiAt: string | null;
  appCalls: number;
  directCalls: number;
  toolCalls: number;
  emailConfirmedAt: string | null;
  /** Other accounts created from the same network in the last 30 days. */
  sameNetwork: number;
  /** theOovi credits used so far. */
  creditsUsed: number;
  /** Days with any theOovi use, and whether the first of them is the day the account was created. */
  usageDays: number;
  usedOnFirstDayOnly: boolean;
  /** Has the app told us it was opened (app_open events or app calls)? */
  appSeen: boolean;
};

export type Verdict = { level: "ok" | "watch" | "suspicious"; reasons: string[] };

type Base = { id: string; email: string; createdAt: string | null; emailVerified: boolean; lastSeenAt: string | null };

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Signals for these accounts, or null when they can't be read (columns not created yet). */
export async function getSignals(ids: string[]): Promise<Map<string, Signals> | null> {
  if (!ids.length) return new Map();
  try {
    if (!(await ensureSignalColumns())) return null;
    const [u, net, use] = await Promise.all([
      pool.query(
        `SELECT id, signup_country, last_country, signup_via, signup_ref, first_ai_at, last_ai_at, ai_app_calls, ai_direct_calls, ai_tool_calls,
                email_verified_at, last_seen_at
           FROM "user" WHERE id = ANY($1::text[])`,
        [ids],
      ),
      pool.query(
        `SELECT a.id, (SELECT count(*) FROM "user" b WHERE b.signup_net IS NOT NULL AND b.signup_net = a.signup_net AND b.id <> a.id
                         AND b."createdAt"::timestamptz > now() - interval '30 days')::int AS same
           FROM "user" a WHERE a.id = ANY($1::text[]) AND a.signup_net IS NOT NULL`,
        [ids],
      ),
      pool.query(
        `SELECT d.user_id, COALESCE(sum(d.credits_mc), 0)::float8 AS mc, count(DISTINCT d.day) FILTER (WHERE d.calls > 0)::int AS days,
                bool_and(d.day = (u."createdAt"::timestamptz AT TIME ZONE 'UTC')::date) FILTER (WHERE d.calls > 0) AS first_day_only
           FROM ai_usage_daily d JOIN "user" u ON u.id = d.user_id WHERE d.user_id = ANY($1::text[]) GROUP BY d.user_id`,
        [ids],
      ),
    ]);
    const sameBy = new Map(net.rows.map((r) => [String(r.id), n(r.same)]));
    const useBy = new Map(use.rows.map((r) => [String(r.user_id), r]));
    const out = new Map<string, Signals>();
    for (const r of u.rows) {
      const id = String(r.id);
      const x = useBy.get(id);
      out.set(id, {
        signupCountry: (r.signup_country as string | null) ?? null,
        lastCountry: (r.last_country as string | null) ?? null,
        signupVia: (r.signup_via as string | null) ?? null,
        signupRef: (r.signup_ref as string | null) ?? null,
        firstAiAt: iso(r.first_ai_at),
        lastAiAt: iso(r.last_ai_at),
        appCalls: n(r.ai_app_calls),
        directCalls: n(r.ai_direct_calls),
        toolCalls: n(r.ai_tool_calls),
        emailConfirmedAt: iso(r.email_verified_at),
        sameNetwork: sameBy.get(id) ?? 0,
        creditsUsed: x ? n(x.mc) / MC : 0,
        usageDays: x ? n(x.days) : 0,
        usedOnFirstDayOnly: x ? n(x.days) === 1 && x.first_day_only === true : false,
        appSeen: !!r.last_seen_at || n(r.ai_app_calls) > 0,
      });
    }
    return out;
  } catch (err) {
    console.error("reading user signals failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Is this account behaving like a person? A hint, never proof: every rule has an innocent explanation,
 * so nothing here blocks anyone. Points: 3 or more = suspicious, 1 or more = watch.
 */
export function assess(u: Base, s: Signals): Verdict {
  const reasons: string[] = [];
  let points = 0;
  const add = (p: number, why: string) => {
    points += p;
    reasons.push(why);
  };
  const used = Math.round(s.creditsUsed);
  if (used >= 200 && !s.appSeen) add(2, `Used ${used} credits but never opened the desktop app`);
  if (s.directCalls >= 3 && s.appCalls === 0) add(2, `${s.directCalls} theOovi requests without the app’s version and system headers`);
  if (s.sameNetwork >= 2) add(2, `${s.sameNetwork} other accounts were created from the same network in 30 days`);
  if (isDisposableEmail(u.email)) add(2, `Temporary email address (${emailDomain(u.email)})`);
  if (used >= 500 && s.usedOnFirstDayOnly) add(1, `Used ${used} credits, all on the day the account was created`);
  if (used >= 200 && !u.emailVerified) add(1, `Used ${used} credits with an unconfirmed email`);
  return { level: points >= 3 ? "suspicious" : points >= 1 ? "watch" : "ok", reasons };
}

/** A country code as a readable name, falling back to the code. */
export function countryLabel(code: string | null): string {
  if (!code) return "–";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
