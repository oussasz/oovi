// Pilot invitations sent from Admin > Pilot: who got one, when, and who sent it. Every send is written
// to the audit log (admin_audit, action "pilot.invite", target = the address), which is also the memory
// that stops the same person from being invited twice by accident.
import { pool } from "./db";

export type SentInvite = { email: string; by: string; at: string; again: boolean };

/** When this address was last invited, or null. */
export async function lastInviteTo(email: string): Promise<Date | null> {
  const { rows } = await pool.query<{ at: Date }>(
    `SELECT created_at AS at FROM admin_audit WHERE action = 'pilot.invite' AND target = $1 ORDER BY created_at DESC LIMIT 1`,
    [email.trim().toLowerCase()],
  );
  return rows[0]?.at ?? null;
}

/** The name on the account with this email (for the greeting), or null when there's no account. */
export async function accountNameFor(email: string): Promise<string | null> {
  const { rows } = await pool.query<{ name: string | null }>('SELECT name FROM "user" WHERE lower(email) = lower($1) LIMIT 1', [email.trim()]);
  const n = rows[0]?.name?.trim();
  return n ? n : null;
}

/** The latest invitations, newest first. Empty when the log can't be read. */
export async function recentInvites(limit = 10): Promise<SentInvite[]> {
  try {
    const { rows } = await pool.query(
      `SELECT target, admin_email, created_at, detail FROM admin_audit WHERE action = 'pilot.invite' ORDER BY created_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      email: String(r.target ?? ""),
      by: String(r.admin_email ?? ""),
      at: new Date(r.created_at as string).toISOString(),
      again: !!(r.detail && typeof r.detail === "object" && (r.detail as { again?: boolean }).again),
    }));
  } catch (err) {
    console.error("recent invites failed", err instanceof Error ? err.message : err);
    return [];
  }
}
