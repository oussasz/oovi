// Who a page opened from the app is for: the website's session if there is one, else the app's single-use link
// (lib/app-links.ts). Only what the pages need: id, email, when the account was made.
import { appLinkUser, type AppLinkPurpose } from "./app-links";
import { pool } from "./db";
import { getServerSession } from "./session";

export type LinkedUser = { id: string; email: string; createdAt: Date; via: "session" | "link" };

export async function userFor(token: unknown, purpose: AppLinkPurpose): Promise<LinkedUser | null> {
  const session = await getServerSession();
  if (session?.user) return { id: session.user.id, email: session.user.email, createdAt: new Date(session.user.createdAt), via: "session" };
  const id = await appLinkUser(token, purpose).catch(() => null);
  if (!id) return null;
  const { rows } = await pool.query<{ id: string; email: string; createdAt: Date }>('SELECT id, email, "createdAt" FROM "user" WHERE id = $1', [id]);
  return rows[0] ? { id: rows[0].id, email: rows[0].email, createdAt: new Date(rows[0].createdAt), via: "link" } : null;
}
