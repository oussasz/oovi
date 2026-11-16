// A user's oovi setup, kept for their other computers (the app's lib/setup-sync.ts): bots, groups,
// skills, routines, connectors without keys, a few settings and what the bots learned about them. Never
// chats or keys. Stored compressed and encrypted (the same box as other secrets, lib/ai-config.ts), one
// row per account, with a version: a save based on an older version is refused (409) and the app merges
// again. Deleted with the account (ON DELETE CASCADE). The table is created on first use (and in
// scripts/migrate.mjs).
import zlib from "node:zlib";
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";

export const MAX_SETUP_BYTES = 8 * 1024 * 1024;

export const SETUP_DDL = `
  CREATE TABLE IF NOT EXISTS account_setup (
    user_id    TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    data       JSONB NOT NULL,
    bytes      INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const g = globalThis as typeof globalThis & { __ooviSetupTable?: boolean };
async function ensureTable() {
  if (g.__ooviSetupTable) return;
  await pool.query(SETUP_DDL);
  g.__ooviSetupTable = true;
}

export async function readSetup(userId: string): Promise<{ version: number; items: Record<string, unknown> | null }> {
  await ensureTable();
  const { rows } = await pool.query("SELECT version, data FROM account_setup WHERE user_id = $1", [userId]);
  if (!rows[0]) return { version: 0, items: null };
  const text = zlib.gunzipSync(Buffer.from(unsealSecret(rows[0].data as Sealed), "base64")).toString("utf8");
  return { version: Number(rows[0].version), items: JSON.parse(text) as Record<string, unknown> };
}

/** Saves when baseVersion is the current one; otherwise "conflict" (another computer saved first). */
export async function writeSetup(userId: string, baseVersion: number, items: Record<string, unknown>): Promise<{ version: number } | "conflict"> {
  await ensureTable();
  const json = JSON.stringify(items);
  const data = sealSecret(zlib.gzipSync(json).toString("base64"));
  const next = baseVersion + 1;
  const r =
    baseVersion === 0
      ? await pool.query("INSERT INTO account_setup (user_id, version, data, bytes) VALUES ($1, 1, $2, $3) ON CONFLICT (user_id) DO NOTHING", [userId, data, json.length])
      : await pool.query("UPDATE account_setup SET version = $2, data = $3, bytes = $4, updated_at = now() WHERE user_id = $1 AND version = $5", [userId, next, data, json.length, baseVersion]);
  return r.rowCount ? { version: next } : "conflict";
}
