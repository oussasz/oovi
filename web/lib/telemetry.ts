// Product analytics recorded by the website and the desktop app's API calls.
// Rules: never store IP addresses, never store chat content. Recording must
// never break the request it rides on, so every writer here swallows errors.
import { pool } from "./db";

export const PLATFORMS = ["win32", "darwin", "linux"] as const;
export type Platform = (typeof PLATFORMS)[number];

const VERSION_RE = /^\d+\.\d+\.\d+/;

/** "1.4.2" or "1.4.2-beta.1" (max 20 chars). Anything else is null. */
export function parseVersion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 20 || !VERSION_RE.test(s) || !/^[0-9A-Za-z.+-]+$/.test(s)) return null;
  return s;
}

export function parsePlatform(v: unknown): Platform | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (PLATFORMS as readonly string[]).includes(s) ? (s as Platform) : null;
}

/** Two-letter country code from Vercel's edge header, if present. */
export function countryFromHeaders(h: Headers): string | null {
  const c = h.get("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

/** Link previewers and crawlers also hit download links; don't count them. */
export function looksLikeBot(h: Headers): boolean {
  const ua = h.get("user-agent") ?? "";
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|curl\/|wget|python-requests|headless/i.test(
    ua,
  );
}

/** Resolves after `ms` so a slow database never holds a response for long. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

export async function recordDownload(target: string, country: string | null): Promise<void> {
  try {
    await withTimeout(
      pool.query(`INSERT INTO app_events (kind, data) VALUES ('download', $1::jsonb)`, [
        JSON.stringify({ target, country }),
      ]),
      2500,
    );
  } catch (err) {
    console.error("download event insert failed", err);
  }
}

/**
 * Called when the desktop app loads the signed-in user on startup.
 * Updates the user's last-seen info and logs at most one app_open per hour.
 */
export async function recordAppOpen(userId: string, version: string | null, platform: string | null): Promise<void> {
  try {
    await withTimeout(
      Promise.all([
        pool.query(
          `UPDATE "user"
              SET last_seen_at = now(),
                  last_app_version = COALESCE($2, last_app_version),
                  last_platform = COALESCE($3, last_platform)
            WHERE id = $1`,
          [userId, version, platform],
        ),
        pool.query(
          `INSERT INTO app_events (user_id, kind, platform, app_version)
           SELECT $1, 'app_open', $2, $3
            WHERE NOT EXISTS (
              SELECT 1 FROM app_events
               WHERE user_id = $1 AND kind = 'app_open' AND created_at > now() - interval '1 hour'
            )`,
          [userId, platform, version],
        ),
      ]),
      2500,
    );
  } catch (err) {
    console.error("app open record failed", err);
  }
}

// ---------- daily usage reports from the desktop app ----------

export const USAGE_COUNT_KEYS = [
  "messages",
  "botReplies",
  "toolCalls",
  "tokensIn",
  "tokensOut",
  "costUsd",
  "filesCreated",
  "searches",
  "sandboxRuns",
  "webPages",
] as const;
export type UsageCountKey = (typeof USAGE_COUNT_KEYS)[number];
export type UsageCounts = Record<UsageCountKey, number>;

export const USAGE_TOTAL_KEYS = ["bots", "groups", "connectors", "skills"] as const;
export type UsageTotalKey = (typeof USAGE_TOTAL_KEYS)[number];
export type UsageTotals = Record<UsageTotalKey, number>;

export type UsageReport = {
  day: string;
  appVersion: string | null;
  platform: Platform | null;
  counts: UsageCounts;
  totals: UsageTotals | null;
};

const COUNT_MAX = 1_000_000_000; // per day, per counter
const COST_MAX = 100_000; // USD per day
const TOTAL_MAX = 100_000;
export const USAGE_MAX_AGE_DAYS = 14;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown, max: number, integer: boolean, label: string): number | string {
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number" || !Number.isFinite(v)) return `${label} must be a finite number.`;
  if (v < 0) return `${label} must be 0 or more.`;
  if (v > max) return `${label} is too large.`;
  return integer ? Math.round(v) : Math.round(v * 1e6) / 1e6;
}

/** Strictly validates a usage report body. Unknown counter names are ignored (newer apps). */
export function validateUsageReport(body: Record<string, unknown>, now = new Date()): UsageReport | string {
  const day = body.day;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "day must be a YYYY-MM-DD string.";
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || utcDay(parsed) !== day) return "day is not a real date.";
  // Allow one day ahead for users east of UTC.
  const tomorrow = utcDay(new Date(now.getTime() + 86_400_000));
  const oldest = utcDay(new Date(now.getTime() - USAGE_MAX_AGE_DAYS * 86_400_000));
  if (day > tomorrow || day < oldest) return `day must be within the last ${USAGE_MAX_AGE_DAYS} days.`;

  let appVersion: string | null = null;
  if (body.appVersion !== undefined && body.appVersion !== null) {
    appVersion = parseVersion(body.appVersion);
    if (!appVersion) return "appVersion must look like 1.2.3 (max 20 characters).";
  }
  let platform: Platform | null = null;
  if (body.platform !== undefined && body.platform !== null) {
    platform = parsePlatform(body.platform);
    if (!platform) return "platform must be win32, darwin or linux.";
  }

  const rawCounts = body.counts;
  if (!rawCounts || typeof rawCounts !== "object" || Array.isArray(rawCounts)) return "counts must be an object.";
  const counts = {} as UsageCounts;
  for (const key of USAGE_COUNT_KEYS) {
    const isCost = key === "costUsd";
    const v = num((rawCounts as Record<string, unknown>)[key], isCost ? COST_MAX : COUNT_MAX, !isCost, `counts.${key}`);
    if (typeof v === "string") return v;
    counts[key] = v;
  }

  let totals: UsageTotals | null = null;
  const rawTotals = body.totals;
  if (rawTotals !== undefined && rawTotals !== null) {
    if (typeof rawTotals !== "object" || Array.isArray(rawTotals)) return "totals must be an object.";
    totals = {} as UsageTotals;
    for (const key of USAGE_TOTAL_KEYS) {
      const v = num((rawTotals as Record<string, unknown>)[key], TOTAL_MAX, true, `totals.${key}`);
      if (typeof v === "string") return v;
      totals[key] = v;
    }
  }

  return { day, appVersion, platform, counts, totals };
}

export async function saveUsageReport(userId: string, r: UsageReport): Promise<void> {
  await pool.query(
    `INSERT INTO usage_daily (user_id, day, app_version, platform, counts, totals, updated_at)
     VALUES ($1, $2::date, $3, $4, $5::jsonb, $6::jsonb, now())
     ON CONFLICT (user_id, day) DO UPDATE
        SET counts = EXCLUDED.counts,
            totals = COALESCE(EXCLUDED.totals, usage_daily.totals),
            app_version = COALESCE(EXCLUDED.app_version, usage_daily.app_version),
            platform = COALESCE(EXCLUDED.platform, usage_daily.platform),
            updated_at = now()`,
    [userId, r.day, r.appVersion, r.platform, JSON.stringify(r.counts), r.totals ? JSON.stringify(r.totals) : null],
  );
}
