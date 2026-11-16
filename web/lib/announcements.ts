// Announcements (Admin > Announcements): news the owner writes in HTML ("A new expert joined oovi") and
// sends through any of three channels:
// - email: the HTML as the email, with an unsubscribe link (people who unsubscribed are skipped);
// - window: a window in the app that shows the HTML (in a locked frame: no scripts, links open in the
//   user's browser), once per person;
// - bar: a line at the top of the app, like the update bar, that opens the window.
// Audience: everyone, or one test person (by email) to check it before everyone sees it. Each person's
// "seen" and "closed" are kept, so it is counted and never shown again on any of their computers.
// Tables are created on first use (and in scripts/migrate.mjs).
import crypto from "node:crypto";
import { pool } from "./db";
import { siteUrl } from "./site";

export const ANN_STATUSES = ["draft", "live", "ended"] as const;
export type AnnStatus = (typeof ANN_STATUSES)[number];
export type Announcement = {
  id: string;
  title: string;
  barText: string;
  html: string;
  email: boolean;
  window: boolean;
  bar: boolean;
  /** "" = everyone; an email = only that person (a test). */
  testEmail: string;
  status: AnnStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export const LIMITS = { title: 140, barText: 160, html: 200_000 };

export const ANN_DDL = `
  CREATE TABLE IF NOT EXISTS announcements (
    id         BIGSERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    bar_text   TEXT NOT NULL DEFAULT '',
    html       TEXT NOT NULL,
    ch_email   BOOLEAN NOT NULL DEFAULT false,
    ch_window  BOOLEAN NOT NULL DEFAULT true,
    ch_bar     BOOLEAN NOT NULL DEFAULT false,
    test_email TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'draft',
    starts_at  TIMESTAMPTZ NULL,
    ends_at    TIMESTAMPTZ NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS announcement_events (
    announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id, kind)
  );
  ALTER TABLE "user" ADD COLUMN IF NOT EXISTS news_opt_out BOOLEAN NOT NULL DEFAULT false;
`;

const g = globalThis as typeof globalThis & { __ooviAnnTables?: boolean };
export async function ensureAnnTables(): Promise<void> {
  if (g.__ooviAnnTables) return;
  await pool.query(ANN_DDL);
  g.__ooviAnnTables = true;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
function toAnn(r: Record<string, unknown>): Announcement {
  return {
    id: String(r.id),
    title: String(r.title),
    barText: String(r.bar_text ?? ""),
    html: String(r.html),
    email: r.ch_email === true,
    window: r.ch_window === true,
    bar: r.ch_bar === true,
    testEmail: String(r.test_email ?? ""),
    status: (ANN_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as AnnStatus) : "draft",
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    createdBy: String(r.created_by),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
  };
}

export async function listAnnouncements(): Promise<(Announcement & { stats: Record<string, number> })[]> {
  await ensureAnnTables();
  const [rows, stats] = await Promise.all([
    pool.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 200"),
    pool.query("SELECT announcement_id, kind, count(*) AS n FROM announcement_events GROUP BY 1, 2"),
  ]);
  const by = new Map<string, Record<string, number>>();
  for (const s of stats.rows) {
    const k = String(s.announcement_id);
    by.set(k, { ...(by.get(k) ?? {}), [String(s.kind)]: Number(s.n) });
  }
  return rows.rows.map((r) => ({ ...toAnn(r), stats: by.get(String(r.id)) ?? {} }));
}

export async function getAnnouncement(id: string): Promise<(Announcement & { stats: Record<string, number> }) | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  await ensureAnnTables();
  const { rows } = await pool.query("SELECT * FROM announcements WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const s = await pool.query("SELECT kind, count(*) AS n FROM announcement_events WHERE announcement_id = $1 GROUP BY 1", [id]);
  return { ...toAnn(rows[0]), stats: Object.fromEntries(s.rows.map((x) => [String(x.kind), Number(x.n)])) };
}

export type AnnInput = Pick<Announcement, "title" | "barText" | "html" | "email" | "window" | "bar" | "testEmail" | "startsAt" | "endsAt">;

export async function saveAnnouncement(id: string | null, v: AnnInput, by: string): Promise<string> {
  await ensureAnnTables();
  const vals = [v.title, v.barText, v.html, v.email, v.window, v.bar, v.testEmail.toLowerCase(), v.startsAt, v.endsAt];
  if (id) {
    await pool.query(
      "UPDATE announcements SET title=$2, bar_text=$3, html=$4, ch_email=$5, ch_window=$6, ch_bar=$7, test_email=$8, starts_at=$9, ends_at=$10, updated_at=now() WHERE id=$1",
      [id, ...vals],
    );
    return id;
  }
  const { rows } = await pool.query(
    "INSERT INTO announcements (title, bar_text, html, ch_email, ch_window, ch_bar, test_email, starts_at, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [...vals, by],
  );
  return String(rows[0].id);
}

export async function setStatus(id: string, status: AnnStatus): Promise<void> {
  await ensureAnnTables();
  await pool.query("UPDATE announcements SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await ensureAnnTables();
  await pool.query("DELETE FROM announcements WHERE id = $1", [id]);
}

// ---------- in the app ----------

/** What the app shows this person now: live, in its dates, for them, not closed yet. */
export async function activeFor(userId: string, email: string): Promise<{ id: string; title: string; barText: string; html: string; window: boolean; bar: boolean; seen: boolean }[]> {
  await ensureAnnTables();
  const { rows } = await pool.query(
    `SELECT a.*, EXISTS (SELECT 1 FROM announcement_events e WHERE e.announcement_id = a.id AND e.user_id = $1 AND e.kind = 'shown') AS seen
       FROM announcements a
      WHERE a.status = 'live' AND (a.ch_window OR a.ch_bar)
        AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at > now())
        AND (a.test_email = '' OR a.test_email = lower($2))
        AND NOT EXISTS (SELECT 1 FROM announcement_events e WHERE e.announcement_id = a.id AND e.user_id = $1 AND e.kind = 'closed')
      ORDER BY a.created_at DESC LIMIT 3`,
    [userId, email],
  );
  return rows.map((r) => ({ id: String(r.id), title: String(r.title), barText: String(r.bar_text ?? ""), html: String(r.html), window: r.ch_window === true, bar: r.ch_bar === true, seen: r.seen === true }));
}

export const EVENT_KINDS = ["shown", "opened", "closed"] as const;
export async function recordEvent(id: string, userId: string, kind: (typeof EVENT_KINDS)[number] | "emailed"): Promise<void> {
  if (!/^\d{1,18}$/.test(id)) return;
  await ensureAnnTables();
  await pool.query("INSERT INTO announcement_events (announcement_id, user_id, kind) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM announcements WHERE id = $1) ON CONFLICT DO NOTHING", [id, userId, kind]);
}

// ---------- email ----------

/** The people the email goes to now (at most `limit`): the audience, minus who got it or unsubscribed. */
export async function emailRecipients(a: Announcement, limit: number): Promise<{ id: string; email: string; name: string | null }[]> {
  await ensureAnnTables();
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name FROM "user" u
      WHERE u."emailVerified" = true AND COALESCE(u.oovi_status, 'active') <> 'blocked'
        AND ($2 = '' OR lower(u.email) = $2)
        AND ($2 <> '' OR u.news_opt_out = false)
        AND NOT EXISTS (SELECT 1 FROM announcement_events e WHERE e.announcement_id = $1 AND e.user_id = u.id AND e.kind = 'emailed')
      ORDER BY u."createdAt" LIMIT $3`,
    [a.id, a.testEmail.toLowerCase(), limit],
  );
  return rows.map((r) => ({ id: String(r.id), email: String(r.email), name: r.name ? String(r.name) : null }));
}

export async function emailCounts(a: Announcement): Promise<{ sent: number; left: number }> {
  await ensureAnnTables();
  const sent = await pool.query("SELECT count(*) AS n FROM announcement_events WHERE announcement_id = $1 AND kind = 'emailed'", [a.id]);
  const left = await pool.query(
    `SELECT count(*) AS n FROM "user" u
      WHERE u."emailVerified" = true AND COALESCE(u.oovi_status, 'active') <> 'blocked'
        AND ($2 = '' OR lower(u.email) = $2) AND ($2 <> '' OR u.news_opt_out = false)
        AND NOT EXISTS (SELECT 1 FROM announcement_events e WHERE e.announcement_id = $1 AND e.user_id = u.id AND e.kind = 'emailed')`,
    [a.id, a.testEmail.toLowerCase()],
  );
  return { sent: Number(sent.rows[0]?.n ?? 0), left: Number(left.rows[0]?.n ?? 0) };
}

// One-click unsubscribe: a link signed for that person (no sign-in needed), as mail providers expect.
function unsubKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AI_KEY_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  return crypto.createHash("sha256").update(`oovi-unsubscribe:${secret}`).digest();
}
export function unsubToken(userId: string): string {
  const sig = crypto.createHmac("sha256", unsubKey()).update(userId).digest("base64url").slice(0, 32);
  return `${Buffer.from(userId).toString("base64url")}.${sig}`;
}
export function readUnsubToken(token: string): string | null {
  const [u, sig] = String(token ?? "").split(".");
  if (!u || !sig) return null;
  let userId = "";
  try {
    userId = Buffer.from(u, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const want = Buffer.from(unsubToken(userId).split(".")[1]!);
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? userId : null;
}
export const unsubUrl = (userId: string) => `${siteUrl()}/unsubscribe?t=${encodeURIComponent(unsubToken(userId))}`;

export async function newsOptedOut(userId: string): Promise<boolean> {
  await ensureAnnTables();
  const { rows } = await pool.query('SELECT news_opt_out FROM "user" WHERE id = $1', [userId]);
  return rows[0]?.news_opt_out === true;
}

export async function setNewsOptOut(userId: string, out: boolean): Promise<void> {
  await ensureAnnTables();
  await pool.query('UPDATE "user" SET news_opt_out = $2 WHERE id = $1', [userId, out]);
}

/** The email: the owner's HTML, with a small footer (why they got it, unsubscribe) put before </body>. */
export function announcementEmail(a: Announcement, to: { id: string; email: string }): { to: string; subject: string; html: string; text: string; headers: Record<string, string> } {
  const url = unsubUrl(to.id);
  const footer = `<div style="margin:28px auto 8px;max-width:560px;font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#8a8a8a;text-align:center">You get this because you have an oovi account. <a href="${url}" style="color:#8a8a8a">Unsubscribe from oovi news</a>.</div>`;
  const html = /<\/body>/i.test(a.html) ? a.html.replace(/<\/body>/i, `${footer}</body>`) : `${a.html}${footer}`;
  return {
    to: to.email,
    subject: a.title,
    html,
    text: `${htmlToText(a.html)}\n\n--\nYou get this because you have an oovi account. Unsubscribe: ${url}`,
    headers: { "List-Unsubscribe": `<${siteUrl()}/api/v1/unsubscribe?t=${encodeURIComponent(unsubToken(to.id))}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/** A readable plain-text copy of the HTML (for mail apps that show text). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `${label.replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}
