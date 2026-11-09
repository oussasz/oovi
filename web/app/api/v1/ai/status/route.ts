// What the app shows next to theOovi: credits, today's limit, plan, pilot and links.
import { apiError, clientIp, getRequestSession, json } from "@/lib/api";
import { creditStatus, isBlocked } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  if (await isBlocked(session.user.id)) return json({ error: "This account has been blocked. Contact contact@conuron.com.", code: "blocked" }, 403);
  try {
    return json(await creditStatus(session.user.id, session.user.createdAt, clientIp(req)));
  } catch (err) {
    console.error("credit status failed", err instanceof Error ? err.message : err);
    return apiError("Couldn't load your credits. Please try again.", 503);
  }
}
