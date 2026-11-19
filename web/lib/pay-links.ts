// Payment links made for the app (POST /api/v1/billing/link, page /pay/<token>). A link is 32 random bytes; only
// its SHA-256 is stored, with the account it belongs to and what it opens (a checkout, maybe for one price, or the
// billing portal). It works once, for 10 minutes. Deleted with the account. Table created on first use and in
// scripts/migrate.mjs.
import crypto from "node:crypto";
import { pool } from "./db";
import { MAX_LINKS_PER_WINDOW, PAY_LINK_SECONDS, TOKEN_RE, type PayKind } from "./pay-core";

export const PAY_DDL = `
  CREATE TABLE IF NOT EXISTS pay_links (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('checkout', 'portal')),
    price_id   TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at    TIMESTAMPTZ NULL
  );
  CREATE INDEX IF NOT EXISTS pay_links_user_idx ON pay_links (user_id, created_at);
`;

const g = globalThis as typeof globalThis & { __ooviPayTable?: Promise<void> };
function ensureTable(): Promise<void> {
  g.__ooviPayTable ??= pool.query(PAY_DDL).then(
    () => undefined,
    (err: unknown) => {
      g.__ooviPayTable = undefined;
      throw err;
    },
  );
  return g.__ooviPayTable;
}

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** A new link for this account, or "too_many" when it made MAX_LINKS_PER_WINDOW in the last 10 minutes. */
export async function createPayLink(userId: string, kind: PayKind, priceId: string | null): Promise<string | "too_many"> {
  await ensureTable();
  await pool.query(`DELETE FROM pay_links WHERE created_at < now() - interval '1 day'`);
  const n = Number(
    (await pool.query(`SELECT count(*) AS n FROM pay_links WHERE user_id = $1 AND created_at > now() - make_interval(secs => ${PAY_LINK_SECONDS})`, [userId])).rows[0].n,
  );
  if (n >= MAX_LINKS_PER_WINDOW) return "too_many";
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO pay_links (token_hash, user_id, kind, price_id) VALUES ($1, $2, $3, $4)", [sha(token), userId, kind, priceId]);
  return token;
}

export type UsedLink = { userId: string; email: string; kind: PayKind; priceId: string | null };

/** Uses a link up (once, under 10 minutes). Null for an unknown, used or expired link: nothing about it is revealed. */
export async function consumePayLink(token: string): Promise<UsedLink | null> {
  if (!TOKEN_RE.test(token)) return null;
  await ensureTable();
  const { rows } = await pool.query(
    `UPDATE pay_links p SET used_at = now() FROM "user" u
      WHERE p.token_hash = $1 AND p.used_at IS NULL AND p.created_at > now() - make_interval(secs => ${PAY_LINK_SECONDS}) AND u.id = p.user_id
      RETURNING p.user_id, p.kind, p.price_id, u.email`,
    [sha(token)],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, email: r.email, kind: r.kind, priceId: r.price_id ?? null } : null;
}
