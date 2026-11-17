// Routines started by a web address (a "webhook"): another service (a form, a shop, Zapier, GitHub…) calls
// https://<site>/api/v1/hooks/<id>/<secret>, the call is kept here, and the user's oovi app collects it
// (GET /api/v1/routine-hooks/events) and runs the routine with what was sent, as outside data. The PC needs
// no public address. Kept: the hook's id and a hash of its secret, and each call (64 KB at most) only until
// the app has collected it (72 hours at most). Tables are created on first use (and in scripts/migrate.mjs).
import crypto from "node:crypto";
import { pool } from "./db";

export const HOOKS_DDL = `
  CREATE TABLE IF NOT EXISTS routine_hooks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    secret_hash TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_at     TIMESTAMPTZ NULL
  );
  CREATE INDEX IF NOT EXISTS routine_hooks_user_idx ON routine_hooks (user_id);
  CREATE TABLE IF NOT EXISTS routine_hook_events (
    id           BIGSERIAL PRIMARY KEY,
    hook_id      TEXT NOT NULL REFERENCES routine_hooks(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    body         TEXT NOT NULL,
    content_type TEXT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS routine_hook_events_user_idx ON routine_hook_events (user_id, id);
`;

export const MAX_HOOKS = 50;
export const MAX_BODY = 64 * 1024;
/** Calls kept per hook per hour (more are refused with 429). */
export const PER_HOUR = 60;
export const ID_RE = /^[0-9a-f]{32}$/;
export const SECRET_RE = /^[0-9a-f]{48}$/;

const g = globalThis as typeof globalThis & { __ooviHookTables?: boolean };
async function ensureTables() {
  if (g.__ooviHookTables) return;
  await pool.query(HOOKS_DDL);
  g.__ooviHookTables = true;
}

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Register (or keep) a hook for this user. An id that belongs to someone else is refused. */
export async function registerHook(userId: string, id: string, secret: string): Promise<"ok" | "taken" | "full"> {
  await ensureTables();
  const cur = await pool.query("SELECT user_id FROM routine_hooks WHERE id = $1", [id]);
  if (cur.rows[0] && cur.rows[0].user_id !== userId) return "taken";
  if (!cur.rows[0]) {
    const n = await pool.query("SELECT count(*)::int AS n FROM routine_hooks WHERE user_id = $1", [userId]);
    if ((n.rows[0]?.n ?? 0) >= MAX_HOOKS) return "full";
  }
  await pool.query("INSERT INTO routine_hooks (id, user_id, secret_hash) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET secret_hash = EXCLUDED.secret_hash", [id, userId, hash(secret)]);
  return "ok";
}

export async function deleteHook(userId: string, id: string): Promise<void> {
  await ensureTables();
  await pool.query("DELETE FROM routine_hooks WHERE id = $1 AND user_id = $2", [id, userId]);
}

/** A call to a hook's address. "missing": unknown hook or wrong secret (never says which). */
export async function receiveHook(id: string, secret: string, body: string, contentType: string | null): Promise<"ok" | "missing" | "busy"> {
  await ensureTables();
  const r = await pool.query("SELECT user_id, secret_hash FROM routine_hooks WHERE id = $1", [id]);
  const row = r.rows[0] as { user_id: string; secret_hash: string } | undefined;
  const given = Buffer.from(hash(secret));
  if (!row || !crypto.timingSafeEqual(given, Buffer.from(row.secret_hash))) return "missing";
  const recent = await pool.query("SELECT count(*)::int AS n FROM routine_hook_events WHERE hook_id = $1 AND created_at > now() - interval '1 hour'", [id]);
  if ((recent.rows[0]?.n ?? 0) >= PER_HOUR) return "busy";
  await pool.query("INSERT INTO routine_hook_events (hook_id, user_id, body, content_type) VALUES ($1, $2, $3, $4)", [id, row.user_id, body.slice(0, MAX_BODY), contentType?.slice(0, 120) ?? null]);
  await pool.query("UPDATE routine_hooks SET last_at = now() WHERE id = $1", [id]);
  // Old calls the app never collected are not kept forever.
  await pool.query("DELETE FROM routine_hook_events WHERE created_at < now() - interval '72 hours'");
  return "ok";
}

export type HookEvent = { id: number; hookId: string; body: string; contentType: string | null; at: string };

/**
 * The user's calls to these hooks after `after` (oldest first, 50 at most). Calls to these hooks up to
 * `after` are forgotten (handled). Only the hooks a computer runs are asked for: another computer of the
 * same user that runs other routines never takes their calls.
 */
export async function collectHooks(userId: string, hooks: string[], after: number): Promise<HookEvent[]> {
  await ensureTables();
  const ids = hooks.filter((h) => ID_RE.test(h)).slice(0, MAX_HOOKS);
  if (!ids.length) return [];
  if (after > 0) await pool.query("DELETE FROM routine_hook_events WHERE user_id = $1 AND hook_id = ANY($2) AND id <= $3", [userId, ids, after]);
  const r = await pool.query("SELECT id, hook_id, body, content_type, created_at FROM routine_hook_events WHERE user_id = $1 AND hook_id = ANY($2) AND id > $3 ORDER BY id LIMIT 50", [userId, ids, after]);
  return r.rows.map((x) => ({ id: Number(x.id), hookId: x.hook_id as string, body: x.body as string, contentType: (x.content_type as string | null) ?? null, at: new Date(x.created_at as string).toISOString() }));
}
