// Admin > Problems: what the desktop app reported it couldn't do for customers (lib/run-report.ts in the
// app): tool errors, turns that stopped with an error, and tasks a bot couldn't complete. The same problem
// from many people is one line; the owner marks it "Fixed in 0.10.14", and if it is reported again from
// that version or newer, it shows as "Came back".
// The columns and the table are created on first use (and in scripts/migrate.mjs), so a deploy works
// before the migration has been run.
import { pool } from "./db";
import { compareVersions } from "./versions";

export { PROBLEM_TAGS, PROBLEM_TAG_LABELS, VERSION_RE, cameBack, problemKey, type ProblemTag } from "./problem-key";
import { PROBLEM_TAGS, cameBack, problemKey, type ProblemTag } from "./problem-key";

const g = globalThis as typeof globalThis & { __ooviProblemCols?: { ok: boolean; at: number; run?: Promise<boolean> } };

/** Makes sure the columns and the fixes table exist. Once per server (again after a minute if it failed). */
export async function ensureProblemColumns(): Promise<boolean> {
  const s = (g.__ooviProblemCols ??= { ok: false, at: 0 });
  if (s.ok) return true;
  if (s.run) return s.run;
  if (s.at && Date.now() - s.at < 60_000) return false;
  s.run = (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query(PROBLEM_DDL);
      await c.query("COMMIT");
      s.ok = true;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      console.error("problem columns not ready:", err instanceof Error ? err.message : err);
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

export const PROBLEM_DDL = `
  ALTER TABLE feedback ADD COLUMN IF NOT EXISTS problem_key TEXT NULL;
  ALTER TABLE feedback ADD COLUMN IF NOT EXISTS tag TEXT NULL;
  ALTER TABLE feedback ADD COLUMN IF NOT EXISTS tool TEXT NULL;
  ALTER TABLE feedback ADD COLUMN IF NOT EXISTS site TEXT NULL;
  CREATE INDEX IF NOT EXISTS feedback_problem_key_idx ON feedback (problem_key, created_at DESC) WHERE problem_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS problem_fixes (
    problem_key TEXT PRIMARY KEY,
    fixed_in    TEXT NOT NULL,
    fixed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    fixed_by    TEXT NULL
  );
`;

/**
 * Saves one report. Returns "new" the first time this problem is seen, "back" the first time it is seen
 * again after being marked fixed (from the fixed version or newer), otherwise null: the caller sends one
 * email for "new" and "back" only.
 */
export async function saveProblem(p: {
  userId: string;
  message: string;
  tag: ProblemTag;
  tool: string | null;
  site: string | null;
  version: string | null;
  platform: string | null;
}): Promise<"new" | "back" | null> {
  const ready = await ensureProblemColumns();
  // The same person, the same note and the same app version: once in 30 days.
  const seen = await pool.query(
    "SELECT 1 FROM feedback WHERE user_id = $1 AND source = 'bot' AND message = $2 AND app_version IS NOT DISTINCT FROM $3 AND created_at > now() - interval '30 days' LIMIT 1",
    [p.userId, p.message, p.version],
  );
  if (seen.rowCount) return null;
  if (!ready) {
    await pool.query("INSERT INTO feedback (user_id, kind, message, source, app_version, platform) VALUES ($1, 'problem', $2, 'bot', $3, $4)", [p.userId, p.message, p.version, p.platform]);
    return null;
  }
  const key = problemKey(p.message);
  const [before, fix] = await Promise.all([
    pool.query("SELECT app_version, created_at FROM feedback WHERE problem_key = $1 ORDER BY created_at DESC LIMIT 200", [key]),
    pool.query("SELECT fixed_in, fixed_at FROM problem_fixes WHERE problem_key = $1", [key]),
  ]);
  await pool.query(
    "INSERT INTO feedback (user_id, kind, message, source, app_version, platform, problem_key, tag, tool, site) VALUES ($1, 'problem', $2, 'bot', $3, $4, $5, $6, $7, $8)",
    [p.userId, p.message, p.version, p.platform, key, p.tag, p.tool, p.site],
  );
  if (!before.rowCount) return "new";
  const f = fix.rows[0] ? { fixedIn: String(fix.rows[0].fixed_in), fixedAt: new Date(fix.rows[0].fixed_at as string) } : null;
  if (!f || !cameBack(f, p.version)) return null;
  const already = before.rows.some((r) => new Date(r.created_at as string) > f.fixedAt && cameBack(f, (r.app_version as string | null) ?? null));
  return already ? null : "back";
}

/** Tool notes sent before this page existed get their key, so they are grouped too (a few hundred at a time). */
async function backfill(): Promise<void> {
  try {
    const { rows } = await pool.query("SELECT id, message FROM feedback WHERE source = 'bot' AND problem_key IS NULL ORDER BY id DESC LIMIT 500");
    for (const r of rows) await pool.query("UPDATE feedback SET problem_key = $2, tag = COALESCE(tag, 'tool') WHERE id = $1", [r.id, problemKey(String(r.message))]);
  } catch (err) {
    console.error("problem backfill:", err instanceof Error ? err.message : err);
  }
}

export type ProblemGroup = {
  key: string;
  message: string;
  tag: ProblemTag;
  tool: string | null;
  sites: string[];
  count: number;
  users: number;
  versions: string[];
  platforms: string[];
  firstSeen: string;
  lastSeen: string;
  fixedIn: string | null;
  fixedAt: string | null;
  /** Reports from the fixed version or newer, sent after it was marked fixed. */
  since: number;
  state: "open" | "fixed" | "back";
};

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string => (v ? new Date(v as string).toISOString() : "");
const asTag = (v: unknown): ProblemTag => (PROBLEM_TAGS.includes(v as ProblemTag) ? (v as ProblemTag) : "tool");

/** The problems reported in the last `days` days, most people first. */
export async function getProblems(days: number, filter: { tag: ProblemTag | null; state: ProblemGroup["state"] | null }): Promise<{ groups: ProblemGroup[]; reports: number; users: number }> {
  if (!(await ensureProblemColumns())) return { groups: [], reports: 0, users: 0 };
  await backfill();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [rows, totals] = await Promise.all([
    pool.query(
      `SELECT f.problem_key AS key,
              (array_agg(f.message ORDER BY f.created_at DESC))[1] AS message,
              (array_agg(f.tag ORDER BY f.created_at DESC))[1] AS tag,
              (array_agg(f.tool ORDER BY f.created_at DESC))[1] AS tool,
              array_remove(array_agg(DISTINCT f.site), NULL) AS sites,
              count(*) AS n, count(DISTINCT f.user_id) AS users,
              array_remove(array_agg(DISTINCT f.app_version), NULL) AS versions,
              array_remove(array_agg(DISTINCT f.platform), NULL) AS platforms,
              min(f.created_at) AS first_seen, max(f.created_at) AS last_seen,
              x.fixed_in, x.fixed_at,
              array_agg(f.app_version) FILTER (WHERE x.fixed_at IS NOT NULL AND f.created_at > x.fixed_at) AS after_fix
         FROM feedback f
         LEFT JOIN problem_fixes x ON x.problem_key = f.problem_key
        WHERE f.source = 'bot' AND f.problem_key IS NOT NULL AND f.created_at >= $1::timestamptz
        GROUP BY f.problem_key, x.fixed_in, x.fixed_at
        ORDER BY count(DISTINCT f.user_id) DESC, max(f.created_at) DESC
        LIMIT 500`,
      [since],
    ),
    pool.query("SELECT count(*) AS n, count(DISTINCT user_id) AS users FROM feedback WHERE source = 'bot' AND problem_key IS NOT NULL AND created_at >= $1::timestamptz", [since]),
  ]);
  const groups: ProblemGroup[] = rows.rows.map((r) => {
    const fixedIn = r.fixed_in ? String(r.fixed_in) : null;
    const after = ((r.after_fix as (string | null)[] | null) ?? []).filter((v) => cameBack(fixedIn ? { fixedIn } : null, v)).length;
    return {
      key: String(r.key),
      message: String(r.message),
      tag: asTag(r.tag),
      tool: r.tool ? String(r.tool) : null,
      sites: ((r.sites as string[] | null) ?? []).slice(0, 8),
      count: n(r.n),
      users: n(r.users),
      versions: ((r.versions as string[] | null) ?? []).sort((a, b) => compareVersions(b, a)),
      platforms: (r.platforms as string[] | null) ?? [],
      firstSeen: iso(r.first_seen),
      lastSeen: iso(r.last_seen),
      fixedIn,
      fixedAt: r.fixed_at ? iso(r.fixed_at) : null,
      since: after,
      state: !fixedIn ? "open" : after > 0 ? "back" : "fixed",
    };
  });
  const t = totals.rows[0] ?? {};
  return {
    groups: groups.filter((x) => (!filter.tag || x.tag === filter.tag) && (!filter.state || x.state === filter.state)).slice(0, 200),
    reports: n(t.n),
    users: n(t.users),
  };
}
