// Marketplace pictures for bots' faces (lib/faces.ts Face.image). The admin uploads one in the
// Marketplace editor (resized to 256 px in the browser, checked again here); it is stored once by the
// md5 of its bytes and served to the apps at /api/v1/avatars/<id>. The table is created on first use
// (and in scripts/migrate.mjs).
import { createHash } from "node:crypto";
import { pool } from "./db";

import { MAX_AVATAR_BYTES, isAvatarPng } from "./avatar-png";
export { MAX_AVATAR_BYTES, isAvatarPng };
export const AVATAR_ID = /^[0-9a-f]{32}$/;

const g = globalThis as typeof globalThis & { __ooviAvatarTable?: boolean };

async function ensureTable(): Promise<void> {
  if (g.__ooviAvatarTable) return;
  await pool.query(AVATAR_DDL);
  g.__ooviAvatarTable = true;
}

export const AVATAR_DDL = `
  CREATE TABLE IF NOT EXISTS catalog_avatars (
    id         TEXT PRIMARY KEY,
    png        BYTEA NOT NULL,
    created_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/** Stores a picture (once) and returns its id. */
export async function saveAvatar(png: Buffer, by: string): Promise<string> {
  await ensureTable();
  const id = createHash("md5").update(png).digest("hex");
  await pool.query("INSERT INTO catalog_avatars (id, png, created_by) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [id, png, by]);
  return id;
}

export async function getAvatar(id: string): Promise<Buffer | null> {
  if (!AVATAR_ID.test(id)) return null;
  await ensureTable();
  const { rows } = await pool.query("SELECT png FROM catalog_avatars WHERE id = $1", [id]);
  return rows[0] ? (rows[0].png as Buffer) : null;
}
