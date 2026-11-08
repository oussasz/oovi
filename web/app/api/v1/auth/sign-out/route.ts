import { pool } from "@/lib/db";
import { apiError, getRequestSession, noContent } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  try {
    await pool.query('DELETE FROM "session" WHERE id = $1', [session.session.id]);
  } catch (err) {
    console.error("sign-out failed", err);
    return apiError("Could not sign out.", 500);
  }
  return noContent();
}
