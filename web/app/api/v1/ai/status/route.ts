// What the app shows next to theOovi: credits, today's limit, plan, pilot and links.
import { getAiConfig } from "@/lib/ai-config";
import { supportsComputerToolset } from "@/lib/ai-tools";
import { apiError, clientIp, getRequestSession, json } from "@/lib/api";
import { creditStatus, isBlocked } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  if (await isBlocked(session.user.id)) return json({ error: "This account has been blocked. Contact contact@conuron.com.", code: "blocked" }, 403);
  try {
    const [status, cfg] = await Promise.all([creditStatus(session.user.id, session.user.createdAt, clientIp(req), !!session.user.emailVerified), getAiConfig()]);
    // desktop: the hosted model can use Anthropic's computer toolset (the app offers desktop control only then).
    return json({ ...status, desktop: supportsComputerToolset(cfg.model) || (!!cfg.backupModel && supportsComputerToolset(cfg.backupModel)) });
  } catch (err) {
    console.error("credit status failed", err instanceof Error ? err.message : err);
    return apiError("Couldn't load your credits. Please try again.", 503);
  }
}
