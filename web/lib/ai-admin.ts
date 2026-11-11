// Read-only queries for the theOovi parts of the admin console: a person's credits,
// pilot requests, feedback and the audit log. Every caller must have passed
// requireAdmin() first.
import { pool } from "./db";
import { MC, utcDay } from "./credits";

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const dayStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

export type PilotStatus = "pending" | "approved" | "rejected";
export const PILOT_STATUSES: PilotStatus[] = ["pending", "approved", "rejected"];
export type FeedbackStatus = "new" | "reviewed" | "done";
export const FEEDBACK_STATUSES: FeedbackStatus[] = ["new", "reviewed", "done"];
export type FeedbackKind = "problem" | "improvement" | "other";
export const FEEDBACK_KINDS: FeedbackKind[] = ["problem", "improvement", "other"];

export { TEAM_SIZES, teamSizeLabel } from "./team-sizes";

// ---------- one person ----------

export type CreditAccount = {
  balance: number;
  plan: string;
  planUntil: string | null;
  planRenewsAt: string | null;
  dailyLimitOverride: number | null;
  aiEnabled: boolean;
  todayUsed: number;
  totalUsed: number;
  inflight: number;
  createdAt: string | null;
};

export type LedgerRow = { id: string; credits: number; kind: string; note: string | null; actor: string | null; createdAt: string };
export type AiUsageRow = {
  day: string;
  calls: number;
  errors: number;
  blocked: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  credits: number;
  avgLatencyMs: number | null;
};

export type PilotRequestRow = {
  id: string;
  userId: string;
  email: string | null;
  userCreatedAt: string | null;
  useCase: string;
  organization: string | null;
  role: string | null;
  teamSize: string | null;
  status: PilotStatus;
  credits: number | null;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type FeedbackRow = {
  id: string;
  userId: string | null;
  email: string | null;
  kind: FeedbackKind;
  message: string;
  source: string;
  appVersion: string | null;
  platform: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
};

function toPilot(r: Record<string, unknown>): PilotRequestRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    email: (r.email as string | null) ?? null,
    userCreatedAt: iso(r.user_created_at),
    useCase: String(r.use_case ?? ""),
    organization: (r.organization as string | null) ?? null,
    role: (r.role as string | null) ?? null,
    teamSize: (r.team_size as string | null) ?? null,
    status: r.status as PilotStatus,
    credits: r.credits === null || r.credits === undefined ? null : n(r.credits),
    adminNote: (r.admin_note as string | null) ?? null,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at) ?? "",
  };
}

function toFeedback(r: Record<string, unknown>): FeedbackRow {
  return {
    id: String(r.id),
    userId: (r.user_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    kind: r.kind as FeedbackKind,
    message: String(r.message ?? ""),
    source: String(r.source ?? "web"),
    appVersion: (r.app_version as string | null) ?? null,
    platform: (r.platform as string | null) ?? null,
    status: r.status as FeedbackStatus,
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: iso(r.created_at) ?? "",
  };
}

export type UserCredits = {
  status: "active" | "blocked";
  statusReason: string | null;
  account: CreditAccount | null;
  ledger: LedgerRow[];
  usage: AiUsageRow[];
  pilot: PilotRequestRow | null;
  feedback: FeedbackRow[];
};

export async function getUserCredits(userId: string): Promise<UserCredits> {
  const today = utcDay();
  const [user, account, ledger, usage, pilot, feedback] = await Promise.all([
    pool.query(`SELECT oovi_status, oovi_status_reason FROM "user" WHERE id = $1`, [userId]),
    pool.query(
      `SELECT balance_mc, plan, plan_until, plan_renews_at, daily_limit_override, ai_enabled,
              CASE WHEN day = $2::date THEN day_used_mc ELSE 0 END AS today_mc,
              total_used_mc, inflight, created_at
         FROM credit_accounts WHERE user_id = $1`,
      [userId, today],
    ),
    pool.query(
      `SELECT id, delta_mc, kind, note, actor, created_at FROM credit_ledger
        WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`,
      [userId],
    ),
    pool.query(
      `SELECT day, calls, errors, blocked, input_tokens, output_tokens, cache_read, cache_write,
              cost_usd::float8 AS cost, credits_mc, latency_ms
         FROM ai_usage_daily WHERE user_id = $1 ORDER BY day DESC LIMIT 30`,
      [userId],
    ),
    pool.query(
      `SELECT p.*, u.email, u."createdAt" AS user_created_at
         FROM pilot_requests p LEFT JOIN "user" u ON u.id = p.user_id WHERE p.user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT f.*, NULL AS email FROM feedback f WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 50`,
      [userId],
    ),
  ]);
  const a = account.rows[0];
  return {
    status: user.rows[0]?.oovi_status === "blocked" ? "blocked" : "active",
    statusReason: (user.rows[0]?.oovi_status_reason as string | null) ?? null,
    account: a
      ? {
          balance: n(a.balance_mc) / MC,
          plan: String(a.plan),
          planUntil: iso(a.plan_until),
          planRenewsAt: iso(a.plan_renews_at),
          dailyLimitOverride: a.daily_limit_override === null ? null : n(a.daily_limit_override),
          aiEnabled: Boolean(a.ai_enabled),
          todayUsed: n(a.today_mc) / MC,
          totalUsed: n(a.total_used_mc) / MC,
          inflight: n(a.inflight),
          createdAt: iso(a.created_at),
        }
      : null,
    ledger: ledger.rows.map((r) => ({
      id: String(r.id),
      credits: n(r.delta_mc) / MC,
      kind: String(r.kind),
      note: (r.note as string | null) ?? null,
      actor: (r.actor as string | null) ?? null,
      createdAt: iso(r.created_at) ?? "",
    })),
    usage: usage.rows.map((r) => ({
      day: dayStr(r.day),
      calls: n(r.calls),
      errors: n(r.errors),
      blocked: n(r.blocked),
      inputTokens: n(r.input_tokens),
      outputTokens: n(r.output_tokens),
      cacheRead: n(r.cache_read),
      cacheWrite: n(r.cache_write),
      costUsd: n(r.cost),
      credits: n(r.credits_mc) / MC,
      avgLatencyMs: n(r.calls) > 0 ? n(r.latency_ms) / n(r.calls) : null,
    })),
    pilot: pilot.rows[0] ? toPilot(pilot.rows[0]) : null,
    feedback: feedback.rows.map(toFeedback),
  };
}

// ---------- pilot requests ----------

export async function listPilotRequests(status: PilotStatus | null): Promise<{
  rows: PilotRequestRow[];
  counts: Record<PilotStatus, number>;
}> {
  const [list, counts] = await Promise.all([
    pool.query(
      `SELECT p.*, u.email, u."createdAt" AS user_created_at
         FROM pilot_requests p LEFT JOIN "user" u ON u.id = p.user_id
        WHERE ($1::text IS NULL OR p.status = $1)
        ORDER BY (p.status = 'pending') DESC, p.created_at DESC
        LIMIT 300`,
      [status],
    ),
    pool.query(`SELECT status, count(*) AS c FROM pilot_requests GROUP BY status`),
  ]);
  const c: Record<PilotStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of counts.rows) if (PILOT_STATUSES.includes(r.status)) c[r.status as PilotStatus] = n(r.c);
  return { rows: list.rows.map(toPilot), counts: c };
}

export async function getPilotRequest(id: string): Promise<PilotRequestRow | null> {
  const { rows } = await pool.query(
    `SELECT p.*, u.email, u."createdAt" AS user_created_at
       FROM pilot_requests p LEFT JOIN "user" u ON u.id = p.user_id WHERE p.id = $1`,
    [id],
  );
  return rows[0] ? toPilot(rows[0]) : null;
}

/** Credits granted to approved pilot requests, all time. */
export async function pilotCreditsGranted(): Promise<number> {
  const { rows } = await pool.query(`SELECT COALESCE(sum(credits), 0) AS c FROM pilot_requests WHERE status = 'approved'`);
  return n(rows[0]?.c);
}

// ---------- feedback ----------

/** from: "bots" = notes the app's bots sent about oovi's own tools; "people" = what users wrote themselves. */
export type FeedbackFrom = "people" | "bots";
export const FEEDBACK_FROM: FeedbackFrom[] = ["people", "bots"];

export async function listFeedback(
  status: FeedbackStatus | null,
  kind: FeedbackKind | null,
  from: FeedbackFrom | null = null,
): Promise<{ rows: FeedbackRow[]; counts: Record<FeedbackStatus, number>; kinds: Record<FeedbackKind, number>; bots: { total: number; fresh: number } }> {
  const [list, counts, bots] = await Promise.all([
    pool.query(
      `SELECT f.*, u.email FROM feedback f LEFT JOIN "user" u ON u.id = f.user_id
        WHERE ($1::text IS NULL OR f.status = $1) AND ($2::text IS NULL OR f.kind = $2)
          AND ($3::text IS NULL OR ($3 = 'bots' AND f.source = 'bot') OR ($3 = 'people' AND f.source <> 'bot'))
        ORDER BY (f.status = 'new') DESC, f.created_at DESC
        LIMIT 300`,
      [status, kind, from],
    ),
    pool.query(`SELECT status, kind, count(*) AS c FROM feedback GROUP BY status, kind`),
    pool.query(`SELECT count(*) AS total, count(*) FILTER (WHERE status = 'new') AS fresh FROM feedback WHERE source = 'bot'`),
  ]);
  const c: Record<FeedbackStatus, number> = { new: 0, reviewed: 0, done: 0 };
  const k: Record<FeedbackKind, number> = { problem: 0, improvement: 0, other: 0 };
  for (const r of counts.rows) {
    if (FEEDBACK_STATUSES.includes(r.status)) c[r.status as FeedbackStatus] += n(r.c);
    if (FEEDBACK_KINDS.includes(r.kind)) k[r.kind as FeedbackKind] += n(r.c);
  }
  return { rows: list.rows.map(toFeedback), counts: c, kinds: k, bots: { total: n(bots.rows[0]?.total), fresh: n(bots.rows[0]?.fresh) } };
}

// ---------- audit log ----------

export type AuditRow = { id: string; adminEmail: string; action: string; target: string | null; detail: unknown; createdAt: string };

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const { rows } = await pool.query(
    `SELECT id, admin_email, action, target, detail, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT $1`,
    [Math.min(1000, Math.max(1, limit))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    adminEmail: String(r.admin_email),
    action: String(r.action),
    target: (r.target as string | null) ?? null,
    detail: r.detail ?? null,
    createdAt: iso(r.created_at) ?? "",
  }));
}

/** Emails for audit targets that are user IDs (so the log can link to them). */
export async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x) => x && x.length <= 200))].slice(0, 500);
  if (!unique.length) return new Map();
  const { rows } = await pool.query(`SELECT id, email FROM "user" WHERE id = ANY($1::text[])`, [unique]);
  return new Map(rows.map((r) => [String(r.id), String(r.email)]));
}

/** Does this account exist? (Server actions check before changing anything.) */
export async function userExists(userId: string): Promise<boolean> {
  if (!userId || userId.length > 200) return false;
  const { rows } = await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [userId]);
  return rows.length > 0;
}
