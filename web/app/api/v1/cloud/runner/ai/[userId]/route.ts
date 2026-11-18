// Runner only: a theOovi model call for the account whose job the runner runs, billed to that account's credits
// exactly like /api/v1/ai/messages (same checks: blocked, credits, daily limit, budget). Only for accounts that
// sync and already have theOovi credits (the welcome-credit network check needs the person's own address).
import { pool } from "@/lib/db";
import { aiMessages } from "@/lib/ai-messages";
import { isEnabled } from "@/lib/cloud";
import { isUserId, logCode } from "@/lib/cloud-core";
import { fail, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  let user: { emailVerified: boolean } | null = null;
  try {
    if (!(await isEnabled(userId))) return fail(403, "sync_off", "Cloud sync is off for this account.");
    const u = await pool.query('SELECT "emailVerified" FROM "user" WHERE id = $1', [userId]);
    const acct = await pool.query("SELECT 1 FROM credit_accounts WHERE user_id = $1", [userId]);
    if (!u.rows[0]) return fail(404, "not_found", "No such account.");
    if (!acct.rowCount) return fail(403, "forbidden", "theOovi credits aren't set up for this account yet. Open oovi on the computer once.");
    user = { emailVerified: !!u.rows[0].emailVerified };
  } catch (err) {
    console.error("cloud runner.ai failed:", logCode(err));
    return fail(503, "unavailable", "The cloud isn't available right now.");
  }
  return aiMessages(req, { id: userId, emailVerified: user.emailVerified, via: "runner" });
}
