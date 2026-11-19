// Short-lived, single-use links that the apps open in the browser to do something on the website as the signed-in
// account, without a website sign-in (owner, 2026-11-19: the website has no sign-in or account any more). The app
// asks for one (POST /api/v1/app-links, signed in), opens it; the page reads who it is for, and the action it leads
// to uses it once. Only a hash of the token is kept; it expires after 30 minutes.
import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db";

export const APP_LINK_PURPOSES = ["pilot"] as const;
export type AppLinkPurpose = (typeof APP_LINK_PURPOSES)[number];
export const APP_LINK_MINUTES = 30;

export const APP_LINKS_DDL = `
  CREATE TABLE IF NOT EXISTS app_links (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS app_links_expires ON app_links (expires_at);
`;

const g = globalThis as typeof globalThis & { __ooviAppLinks?: boolean };
async function ensureTable() {
  if (g.__ooviAppLinks) return;
  await pool.query(APP_LINKS_DDL);
  g.__ooviAppLinks = true;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
/** A token the way this file makes them: 43 URL-safe characters. Anything else is never looked up. */
export const isAppLinkToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);

export async function createAppLink(userId: string, purpose: AppLinkPurpose): Promise<string> {
  await ensureTable();
  const token = randomBytes(32).toString("base64url");
  await pool.query("DELETE FROM app_links WHERE expires_at < now() - interval '1 day'");
  await pool.query(`INSERT INTO app_links (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + interval '${APP_LINK_MINUTES} minutes')`, [hash(token), userId, purpose]);
  return token;
}

/** Who an unused, unexpired link is for (it stays usable). */
export async function appLinkUser(token: unknown, purpose: AppLinkPurpose): Promise<string | null> {
  if (!isAppLinkToken(token)) return null;
  await ensureTable();
  const { rows } = await pool.query<{ user_id: string }>("SELECT user_id FROM app_links WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()", [hash(token), purpose]);
  return rows[0]?.user_id ?? null;
}

/** Uses the link: answers who it is for, once (a second use, or an expired link, answers null). */
export async function useAppLink(token: unknown, purpose: AppLinkPurpose): Promise<string | null> {
  if (!isAppLinkToken(token)) return null;
  await ensureTable();
  const { rows } = await pool.query<{ user_id: string }>(
    "UPDATE app_links SET used_at = now() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id",
    [hash(token), purpose],
  );
  return rows[0]?.user_id ?? null;
}
