// Read-only queries behind the admin console. Every caller must have passed
// requireAdmin() first. All days are UTC.
import { pool } from "./db";
import { DOWNLOAD_TARGETS, type DownloadTarget } from "./releases";
import { USAGE_COUNT_KEYS, USAGE_TOTAL_KEYS, type UsageCountKey, type UsageTotalKey } from "./telemetry";

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(v: string | string[] | undefined): Period {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

const DAY_MS = 86_400_000;

function utcDayStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The last `days` UTC days as YYYY-MM-DD, oldest first (today included). */
export function dayKeys(days: number): string[] {
  const today = utcDayStart().getTime();
  return Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Start (UTC midnight) of the first day of a `days`-long window ending today. */
export function windowStart(days: number): Date {
  return new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
}

function fill(keys: string[], rows: { d: string; n: number | string }[]): number[] {
  const m = new Map(rows.map((r) => [r.d, Number(r.n)]));
  return keys.map((k) => m.get(k) ?? 0);
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/** A UTC day key for a timestamp column (works for timestamp and timestamptz). */
const dayOf = (col: string) => `to_char((${col})::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/** Users who opened the desktop app: app_open events, plus last_seen_at. */
const ACTIVE_SOURCES = (since: string) => `
  SELECT user_id AS uid, created_at AS at FROM app_events
   WHERE kind = 'app_open' AND user_id IS NOT NULL AND created_at > ${since}
  UNION ALL
  SELECT id, last_seen_at FROM "user" WHERE last_seen_at > ${since}`;

export type Count = { value: number; previous: number | null };
export type Split = { label: string; value: number }[];

export type Overview = {
  totalUsers: number;
  usersNewInPeriod: Count;
  signupsToday: Count;
  signups7: Count;
  signups30: Count;
  dau: Count;
  wau: Count;
  mau: Count;
  activated: number;
  downloads7: Count;
  downloads30: Count;
  downloadsByTarget7: Record<DownloadTarget, number>;
  downloadsByTarget30: Record<DownloadTarget, number>;
  crashFree7: { active: number; crashed: number; prevActive: number; prevCrashed: number };
  crashes7: Count;
  versions: Split;
  platforms: Split;
  days: string[];
  signupsPerDay: number[];
  activePerDay: number[];
  downloadsPerDay: Record<DownloadTarget, number[]>;
};

export async function getOverview(period: Period): Promise<Overview> {
  const days = dayKeys(period);
  const start = windowStart(period).toISOString();
  const [users, active, dl, crashFree, crashes, versions, platforms, signupsDay, activeDay, dlDay] = await Promise.all([
    pool.query(
      `WITH bounds AS (SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS today)
       SELECT count(*) AS total,
              count(*) FILTER (WHERE c > now() - make_interval(days => $1::int)) AS p,
              count(*) FILTER (WHERE c > now() - make_interval(days => $1::int * 2) AND c <= now() - make_interval(days => $1::int)) AS p_prev,
              count(*) FILTER (WHERE c >= (SELECT today FROM bounds)) AS today,
              count(*) FILTER (WHERE c >= (SELECT today FROM bounds) - interval '1 day' AND c <= now() - interval '1 day') AS today_prev,
              count(*) FILTER (WHERE c > now() - interval '7 days') AS d7,
              count(*) FILTER (WHERE c > now() - interval '14 days' AND c <= now() - interval '7 days') AS d7_prev,
              count(*) FILTER (WHERE c > now() - interval '30 days') AS d30,
              count(*) FILTER (WHERE c > now() - interval '60 days' AND c <= now() - interval '30 days') AS d30_prev,
              count(*) FILTER (WHERE last_seen_at IS NOT NULL OR EXISTS (
                SELECT 1 FROM app_events e WHERE e.user_id = u.id AND e.kind = 'app_open')) AS activated
         FROM (SELECT id, ("createdAt")::timestamptz AS c, last_seen_at FROM "user") u`,
      [period],
    ),
    pool.query(
      `WITH a AS (${ACTIVE_SOURCES("now() - interval '60 days'")})
       SELECT count(DISTINCT uid) FILTER (WHERE at > now() - interval '1 day') AS dau,
              count(DISTINCT uid) FILTER (WHERE at > now() - interval '2 days' AND at <= now() - interval '1 day') AS dau_prev,
              count(DISTINCT uid) FILTER (WHERE at > now() - interval '7 days') AS wau,
              count(DISTINCT uid) FILTER (WHERE at > now() - interval '14 days' AND at <= now() - interval '7 days') AS wau_prev,
              count(DISTINCT uid) FILTER (WHERE at > now() - interval '30 days') AS mau,
              count(DISTINCT uid) FILTER (WHERE at > now() - interval '60 days' AND at <= now() - interval '30 days') AS mau_prev
         FROM a`,
    ),
    pool.query(
      `SELECT data->>'target' AS target,
              count(*) FILTER (WHERE created_at > now() - interval '7 days') AS d7,
              count(*) FILTER (WHERE created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days') AS d7_prev,
              count(*) FILTER (WHERE created_at > now() - interval '30 days') AS d30,
              count(*) FILTER (WHERE created_at <= now() - interval '30 days') AS d30_prev
         FROM app_events
        WHERE kind = 'download' AND created_at > now() - interval '60 days'
        GROUP BY 1`,
    ),
    pool.query(
      `WITH cur AS (
         SELECT DISTINCT uid FROM (${ACTIVE_SOURCES("now() - interval '7 days'")}) x
       ), prev AS (
         SELECT DISTINCT user_id AS uid FROM app_events
          WHERE kind = 'app_open' AND user_id IS NOT NULL
            AND created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days'
       ), crashed AS (
         SELECT DISTINCT user_id AS uid FROM crash_reports
          WHERE user_id IS NOT NULL AND created_at > now() - interval '7 days'
       ), crashed_prev AS (
         SELECT DISTINCT user_id AS uid FROM crash_reports
          WHERE user_id IS NOT NULL AND created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days'
       )
       SELECT (SELECT count(*) FROM cur) AS active,
              (SELECT count(*) FROM cur WHERE uid IN (SELECT uid FROM crashed)) AS crashed,
              (SELECT count(*) FROM prev) AS prev_active,
              (SELECT count(*) FROM prev WHERE uid IN (SELECT uid FROM crashed_prev)) AS prev_crashed`,
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days') AS d7,
              count(*) FILTER (WHERE created_at <= now() - interval '7 days') AS d7_prev
         FROM crash_reports WHERE created_at > now() - interval '14 days'`,
    ),
    pool.query(
      `SELECT COALESCE(last_app_version, 'unknown') AS label, count(*) AS value
         FROM "user" WHERE last_seen_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 12`,
    ),
    pool.query(
      `SELECT COALESCE(last_platform, 'unknown') AS label, count(*) AS value
         FROM "user" WHERE last_seen_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC`,
    ),
    pool.query(
      `SELECT ${dayOf('"createdAt"')} AS d, count(*) AS n FROM "user"
        WHERE ("createdAt")::timestamptz >= $1::timestamptz GROUP BY 1`,
      [start],
    ),
    pool.query(
      `SELECT ${dayOf("created_at")} AS d, count(DISTINCT user_id) AS n FROM app_events
        WHERE kind = 'app_open' AND user_id IS NOT NULL AND created_at >= $1::timestamptz GROUP BY 1`,
      [start],
    ),
    downloadsPerDay(start),
  ]);

  const u = users.rows[0] ?? {};
  const a = active.rows[0] ?? {};
  const cf = crashFree.rows[0] ?? {};
  const cr = crashes.rows[0] ?? {};
  const by7 = emptyTargets();
  const by30 = emptyTargets();
  let d7 = 0,
    d7p = 0,
    d30 = 0,
    d30p = 0;
  for (const r of dl.rows) {
    d7 += n(r.d7);
    d7p += n(r.d7_prev);
    d30 += n(r.d30);
    d30p += n(r.d30_prev);
    const t: unknown = r.target;
    if (isTarget(t)) {
      by7[t] = n(r.d7);
      by30[t] = n(r.d30);
    }
  }

  return {
    totalUsers: n(u.total),
    usersNewInPeriod: { value: n(u.p), previous: n(u.p_prev) },
    signupsToday: { value: n(u.today), previous: n(u.today_prev) },
    signups7: { value: n(u.d7), previous: n(u.d7_prev) },
    signups30: { value: n(u.d30), previous: n(u.d30_prev) },
    dau: { value: n(a.dau), previous: n(a.dau_prev) },
    wau: { value: n(a.wau), previous: n(a.wau_prev) },
    mau: { value: n(a.mau), previous: n(a.mau_prev) },
    activated: n(u.activated),
    downloads7: { value: d7, previous: d7p },
    downloads30: { value: d30, previous: d30p },
    downloadsByTarget7: by7,
    downloadsByTarget30: by30,
    crashFree7: {
      active: n(cf.active),
      crashed: n(cf.crashed),
      prevActive: n(cf.prev_active),
      prevCrashed: n(cf.prev_crashed),
    },
    crashes7: { value: n(cr.d7), previous: n(cr.d7_prev) },
    versions: versions.rows.map((r) => ({ label: String(r.label), value: n(r.value) })),
    platforms: platforms.rows.map((r) => ({ label: String(r.label), value: n(r.value) })),
    days,
    signupsPerDay: fill(days, signupsDay.rows),
    activePerDay: fill(days, activeDay.rows),
    downloadsPerDay: splitDownloadsPerDay(days, dlDay),
  };
}

// ---------- downloads ----------

function emptyTargets(): Record<DownloadTarget, number> {
  return Object.fromEntries(DOWNLOAD_TARGETS.map((t) => [t, 0])) as Record<DownloadTarget, number>;
}

function isTarget(v: unknown): v is DownloadTarget {
  return typeof v === "string" && (DOWNLOAD_TARGETS as readonly string[]).includes(v);
}

type DayTargetRow = { d: string; target: string | null; n: string | number };

async function downloadsPerDay(start: string): Promise<DayTargetRow[]> {
  const { rows } = await pool.query<DayTargetRow>(
    `SELECT ${dayOf("created_at")} AS d, data->>'target' AS target, count(*) AS n
       FROM app_events WHERE kind = 'download' AND created_at >= $1::timestamptz
      GROUP BY 1, 2`,
    [start],
  );
  return rows;
}

function splitDownloadsPerDay(days: string[], rows: DayTargetRow[]): Record<DownloadTarget, number[]> {
  const out = {} as Record<DownloadTarget, number[]>;
  for (const t of DOWNLOAD_TARGETS) {
    out[t] = fill(
      days,
      rows.filter((r) => r.target === t),
    );
  }
  return out;
}

export type DownloadsReport = {
  days: string[];
  perDay: Record<DownloadTarget, number[]>;
  periodByTarget: Record<DownloadTarget, number>;
  allTimeByTarget: Record<DownloadTarget, number>;
  periodTotal: number;
  previousTotal: number;
  allTime: number;
  countries: { country: string; total: number; byTarget: Record<DownloadTarget, number> }[];
};

export async function getDownloads(period: Period): Promise<DownloadsReport> {
  const days = dayKeys(period);
  const start = windowStart(period);
  const prevStart = new Date(start.getTime() - period * DAY_MS);
  const [perDay, totals, countries] = await Promise.all([
    downloadsPerDay(start.toISOString()),
    pool.query(
      `SELECT data->>'target' AS target,
              count(*) FILTER (WHERE created_at >= $1::timestamptz) AS p,
              count(*) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $1::timestamptz) AS prev,
              count(*) AS all_time
         FROM app_events WHERE kind = 'download' GROUP BY 1`,
      [start.toISOString(), prevStart.toISOString()],
    ),
    pool.query(
      `SELECT COALESCE(data->>'country', '') AS country, data->>'target' AS target, count(*) AS n
         FROM app_events WHERE kind = 'download' AND created_at >= $1::timestamptz
        GROUP BY 1, 2`,
      [start.toISOString()],
    ),
  ]);

  const periodByTarget = emptyTargets();
  const allTimeByTarget = emptyTargets();
  let periodTotal = 0,
    previousTotal = 0,
    allTime = 0;
  for (const r of totals.rows) {
    periodTotal += n(r.p);
    previousTotal += n(r.prev);
    allTime += n(r.all_time);
    const t: unknown = r.target;
    if (isTarget(t)) {
      periodByTarget[t] = n(r.p);
      allTimeByTarget[t] = n(r.all_time);
    }
  }

  const byCountry = new Map<string, { country: string; total: number; byTarget: Record<DownloadTarget, number> }>();
  for (const r of countries.rows) {
    const key = String(r.country);
    let row = byCountry.get(key);
    if (!row) {
      row = { country: key, total: 0, byTarget: emptyTargets() };
      byCountry.set(key, row);
    }
    row.total += n(r.n);
    const t: unknown = r.target;
    if (isTarget(t)) row.byTarget[t] += n(r.n);
  }

  return {
    days,
    perDay: splitDownloadsPerDay(days, perDay),
    periodByTarget,
    allTimeByTarget,
    periodTotal,
    previousTotal,
    allTime,
    countries: [...byCountry.values()].sort((x, y) => y.total - x.total).slice(0, 60),
  };
}

// ---------- users ----------

export const USERS_PAGE_SIZE = 25;

export type UserRow = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  appVersion: string | null;
  platform: string | null;
  termsVersion: string | null;
};

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

function toUserRow(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name ?? ""),
    createdAt: iso(r.createdAt) ?? "",
    lastSeenAt: iso(r.last_seen_at),
    appVersion: (r.last_app_version as string | null) ?? null,
    platform: (r.last_platform as string | null) ?? null,
    termsVersion: (r.termsVersion as string | null) ?? null,
  };
}

const USER_COLUMNS = `id, email, name, "createdAt", last_seen_at, last_app_version, last_platform, "termsVersion"`;

export async function listUsers(search: string, page: number): Promise<{ rows: UserRow[]; total: number }> {
  const q = search.trim().slice(0, 100);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const offset = Math.max(0, page - 1) * USERS_PAGE_SIZE;
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, count(*) OVER () AS total
       FROM "user"
      WHERE ($1 = '' OR email ILIKE $2 OR name ILIKE $2)
      ORDER BY "createdAt" DESC, id
      LIMIT ${USERS_PAGE_SIZE} OFFSET $3`,
    [q, like, offset],
  );
  let total = rows[0] ? n(rows[0].total) : 0;
  if (!rows.length && offset > 0) {
    const c = await pool.query(`SELECT count(*) AS c FROM "user" WHERE ($1 = '' OR email ILIKE $2 OR name ILIKE $2)`, [
      q,
      like,
    ]);
    total = n(c.rows[0]?.c);
  }
  return { rows: rows.map(toUserRow), total };
}

export type AppEventRow = {
  id: string;
  kind: string;
  platform: string | null;
  appVersion: string | null;
  data: unknown;
  createdAt: string;
};

export type CrashRow = {
  id: string;
  userId: string | null;
  email: string | null;
  appVersion: string;
  platform: string;
  message: string;
  stack: string | null;
  context: string | null;
  createdAt: string;
};

export type UsageRow = {
  day: string;
  appVersion: string | null;
  platform: string | null;
  counts: Partial<Record<UsageCountKey, number>>;
  totals: Partial<Record<UsageTotalKey, number>> | null;
};

function toCrash(r: Record<string, unknown>): CrashRow {
  return {
    id: String(r.id),
    userId: (r.user_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    appVersion: String(r.app_version),
    platform: String(r.platform),
    message: String(r.message),
    stack: (r.stack as string | null) ?? null,
    context: (r.context as string | null) ?? null,
    createdAt: iso(r.created_at) ?? "",
  };
}

export async function getUserDetail(id: string): Promise<{
  user: UserRow;
  events: AppEventRow[];
  crashes: CrashRow[];
  usage: UsageRow[];
  counts: { events: number; crashes: number; usageDays: number };
} | null> {
  const u = await pool.query(`SELECT ${USER_COLUMNS} FROM "user" WHERE id = $1`, [id]);
  if (!u.rows[0]) return null;
  const [events, crashes, usage, counts] = await Promise.all([
    pool.query(
      `SELECT id, kind, platform, app_version, data, created_at FROM app_events
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [id],
    ),
    pool.query(
      `SELECT id, user_id, NULL AS email, app_version, platform, message, stack, context, created_at
         FROM crash_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [id],
    ),
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, app_version, platform, counts, totals
         FROM usage_daily WHERE user_id = $1 ORDER BY day DESC LIMIT 60`,
      [id],
    ),
    pool.query(
      `SELECT (SELECT count(*) FROM app_events WHERE user_id = $1) AS events,
              (SELECT count(*) FROM crash_reports WHERE user_id = $1) AS crashes,
              (SELECT count(*) FROM usage_daily WHERE user_id = $1) AS usage_days`,
      [id],
    ),
  ]);
  const c = counts.rows[0] ?? {};
  return {
    user: toUserRow(u.rows[0]),
    events: events.rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      platform: r.platform ?? null,
      appVersion: r.app_version ?? null,
      data: r.data ?? null,
      createdAt: iso(r.created_at) ?? "",
    })),
    crashes: crashes.rows.map(toCrash),
    usage: usage.rows.map((r) => ({
      day: String(r.day),
      appVersion: r.app_version ?? null,
      platform: r.platform ?? null,
      counts: (r.counts ?? {}) as UsageRow["counts"],
      totals: (r.totals ?? null) as UsageRow["totals"],
    })),
    counts: { events: n(c.events), crashes: n(c.crashes), usageDays: n(c.usage_days) },
  };
}

// ---------- crashes ----------

export type CrashGroup = {
  hash: string;
  message: string;
  count: number;
  users: number;
  versions: string[];
  platforms: string[];
  firstSeen: string;
  lastSeen: string;
};

export async function getCrashes(period: Period): Promise<{
  days: string[];
  perDay: number[];
  total: number;
  previous: number;
  affectedUsers: number;
  groups: CrashGroup[];
}> {
  const days = dayKeys(period);
  const start = windowStart(period);
  const prevStart = new Date(start.getTime() - period * DAY_MS);
  const [perDay, totals, groups] = await Promise.all([
    pool.query(
      `SELECT ${dayOf("created_at")} AS d, count(*) AS n FROM crash_reports
        WHERE created_at >= $1::timestamptz GROUP BY 1`,
      [start.toISOString()],
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE created_at >= $1::timestamptz) AS total,
              count(*) FILTER (WHERE created_at < $1::timestamptz) AS previous,
              count(DISTINCT user_id) FILTER (WHERE created_at >= $1::timestamptz) AS users
         FROM crash_reports WHERE created_at >= $2::timestamptz`,
      [start.toISOString(), prevStart.toISOString()],
    ),
    pool.query(
      `SELECT md5(g.message) AS hash, left(g.message, 400) AS message, g.n, g.users, g.versions, g.platforms, g.last_seen,
              (SELECT min(c.created_at) FROM crash_reports c WHERE c.message = g.message) AS first_seen
         FROM (
           SELECT message, count(*) AS n, count(DISTINCT user_id) AS users,
                  array_agg(DISTINCT app_version) AS versions, array_agg(DISTINCT platform) AS platforms,
                  max(created_at) AS last_seen
             FROM crash_reports WHERE created_at >= $1::timestamptz
            GROUP BY message
            ORDER BY count(*) DESC, max(created_at) DESC
            LIMIT 20
         ) g
        ORDER BY g.n DESC, g.last_seen DESC`,
      [start.toISOString()],
    ),
  ]);
  const t = totals.rows[0] ?? {};
  return {
    days,
    perDay: fill(days, perDay.rows),
    total: n(t.total),
    previous: n(t.previous),
    affectedUsers: n(t.users),
    groups: groups.rows.map((r) => ({
      hash: String(r.hash),
      message: String(r.message),
      count: n(r.n),
      users: n(r.users),
      versions: ((r.versions as string[] | null) ?? []).sort().reverse(),
      platforms: (r.platforms as string[] | null) ?? [],
      firstSeen: iso(r.first_seen) ?? "",
      lastSeen: iso(r.last_seen) ?? "",
    })),
  };
}

export async function getCrashGroup(hash: string): Promise<{ total: number; users: number; reports: CrashRow[] } | null> {
  if (!/^[a-f0-9]{32}$/.test(hash)) return null;
  const [reports, totals] = await Promise.all([
    pool.query(
      `SELECT c.id, c.user_id, u.email, c.app_version, c.platform, c.message, c.stack, c.context, c.created_at
         FROM crash_reports c LEFT JOIN "user" u ON u.id = c.user_id
        WHERE md5(c.message) = $1 ORDER BY c.created_at DESC LIMIT 50`,
      [hash],
    ),
    pool.query(`SELECT count(*) AS n, count(DISTINCT user_id) AS users FROM crash_reports WHERE md5(message) = $1`, [hash]),
  ]);
  if (!reports.rows.length) return null;
  return { total: n(totals.rows[0]?.n), users: n(totals.rows[0]?.users), reports: reports.rows.map(toCrash) };
}

// ---------- usage ----------

export type UsageSums = Record<UsageCountKey, number>;
export type TotalsStat = { key: UsageTotalKey; users: number; median: number; average: number; p90: number; max: number; zero: number };

const sumCols = USAGE_COUNT_KEYS.map(
  (k) => `COALESCE(sum((counts->>'${k}')::numeric), 0)::float8 AS "${k}"`,
).join(",\n              ");

function toSums(r: Record<string, unknown> | undefined): UsageSums {
  const out = {} as UsageSums;
  for (const k of USAGE_COUNT_KEYS) out[k] = n(r?.[k]);
  return out;
}

export async function getUsage(period: Period): Promise<{
  days: string[];
  perDay: { users: number[]; sums: Record<UsageCountKey, number[]> };
  sums: UsageSums;
  previous: UsageSums;
  users: number;
  previousUsers: number;
  userDays: number;
  totals: TotalsStat[];
}> {
  const days = dayKeys(period);
  const start = windowStart(period).toISOString().slice(0, 10);
  const prevStart = new Date(windowStart(period).getTime() - period * DAY_MS).toISOString().slice(0, 10);
  const totalsValues = USAGE_TOTAL_KEYS.map((k) => `('${k}', (totals->>'${k}')::numeric)`).join(", ");
  const [perDay, cur, prev, dist] = await Promise.all([
    pool.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS d, count(*) AS users,
              ${sumCols}
         FROM usage_daily WHERE day >= $1::date GROUP BY 1`,
      [start],
    ),
    pool.query(
      `SELECT count(DISTINCT user_id) AS users, count(*) AS user_days,
              ${sumCols}
         FROM usage_daily WHERE day >= $1::date`,
      [start],
    ),
    pool.query(
      `SELECT count(DISTINCT user_id) AS users,
              ${sumCols}
         FROM usage_daily WHERE day >= $1::date AND day < $2::date`,
      [prevStart, start],
    ),
    pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (user_id) totals FROM usage_daily
          WHERE day >= $1::date AND totals IS NOT NULL
          ORDER BY user_id, day DESC
       )
       SELECT t.k, count(*) AS users,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY t.v) AS median,
              avg(t.v)::float8 AS average,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY t.v) AS p90,
              max(t.v)::float8 AS max,
              count(*) FILTER (WHERE t.v = 0) AS zero
         FROM latest, LATERAL (VALUES ${totalsValues}) AS t(k, v)
        WHERE t.v IS NOT NULL
        GROUP BY t.k`,
      [start],
    ),
  ]);

  const rowsByDay = perDay.rows as Record<string, unknown>[];
  const sumsPerDay = {} as Record<UsageCountKey, number[]>;
  for (const k of USAGE_COUNT_KEYS) {
    sumsPerDay[k] = fill(
      days,
      rowsByDay.map((r) => ({ d: String(r.d), n: n(r[k]) })),
    );
  }
  const c = cur.rows[0] ?? {};
  const p = prev.rows[0] ?? {};
  const distRows = new Map(dist.rows.map((r) => [String(r.k), r]));
  return {
    days,
    perDay: {
      users: fill(
        days,
        rowsByDay.map((r) => ({ d: String(r.d), n: n(r.users) })),
      ),
      sums: sumsPerDay,
    },
    sums: toSums(c),
    previous: toSums(p),
    users: n(c.users),
    previousUsers: n(p.users),
    userDays: n(c.user_days),
    totals: USAGE_TOTAL_KEYS.map((key) => {
      const r = distRows.get(key);
      return {
        key,
        users: n(r?.users),
        median: n(r?.median),
        average: n(r?.average),
        p90: n(r?.p90),
        max: n(r?.max),
        zero: n(r?.zero),
      };
    }),
  };
}
