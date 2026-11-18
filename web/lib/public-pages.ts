// Pages shared by a public link (lib/public-pages-core.ts): a snapshot of a Canvas page the user chose to share.
// Anyone with the link can read it; nobody can find it (random id, not listed, not indexed). The owner updates
// it or stops sharing from the app; the oovi team can hide a page (admin). Created on first use and in
// scripts/migrate.mjs.
import crypto from "node:crypto";
import { pool } from "./db";
import type { PageContent, PageInput } from "./public-pages-core";

export const PAGES_DDL = `
  CREATE TABLE IF NOT EXISTS public_pages (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    views       INT NOT NULL DEFAULT 0,
    hidden      BOOLEAN NOT NULL DEFAULT false
  );
  CREATE INDEX IF NOT EXISTS public_pages_user_idx ON public_pages (user_id);
`;

export const MAX_PAGES = 200;

const g = globalThis as typeof globalThis & { __ooviPageTables?: boolean };
async function ensureTables() {
  if (g.__ooviPageTables) return;
  await pool.query(PAGES_DDL);
  g.__ooviPageTables = true;
}

/** Share a page, or update one this user already shares (same id). */
export async function savePage(userId: string, page: PageInput, id?: string): Promise<{ id: string } | "full" | "not_found"> {
  await ensureTables();
  if (id) {
    const r = await pool.query("UPDATE public_pages SET title = $3, content = $4, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId, page.title, JSON.stringify(page.content)]);
    return r.rowCount ? { id } : "not_found";
  }
  const n = await pool.query("SELECT count(*)::int AS n FROM public_pages WHERE user_id = $1", [userId]);
  if ((n.rows[0]?.n ?? 0) >= MAX_PAGES) return "full";
  const newId = crypto.randomBytes(16).toString("base64url").slice(0, 22);
  await pool.query("INSERT INTO public_pages (id, user_id, title, content) VALUES ($1, $2, $3, $4)", [newId, userId, page.title, JSON.stringify(page.content)]);
  return { id: newId };
}

export async function deletePage(userId: string, id: string): Promise<void> {
  await ensureTables();
  await pool.query("DELETE FROM public_pages WHERE id = $1 AND user_id = $2", [id, userId]);
}

/** A page to show (counts the view), or null when it isn't there or was hidden. */
export async function readPage(id: string): Promise<{ title: string; content: PageContent; updatedAt: Date } | null> {
  await ensureTables();
  const r = await pool.query("UPDATE public_pages SET views = views + 1 WHERE id = $1 AND NOT hidden RETURNING title, content, updated_at", [id]);
  const row = r.rows[0];
  return row ? { title: row.title, content: row.content as PageContent, updatedAt: row.updated_at } : null;
}
