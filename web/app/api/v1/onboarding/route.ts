// The desktop app reports the first-run steps a user reaches (lib/onboarding-funnel.ts). Signed-in only,
// one record per step and user, nothing typed by the user (only ids of choices).
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { isFunnelStep, recordStep } from "@/lib/onboarding-funnel";
import { parsePlatform, parseVersion } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`onboarding:${session.user.id}`, 20)) return apiError("Too many requests.", 429);
  const body = await readJson(req, 4 * 1024);
  if (!body || !isFunnelStep(body.step)) return apiError("Unknown step.", 400);
  try {
    await recordStep(session.user.id, body.step, body, parsePlatform(req.headers.get("x-oovi-platform")), parseVersion(req.headers.get("x-oovi-version")));
  } catch (err) {
    console.error("onboarding step failed", err instanceof Error ? err.message : err);
  }
  return noContent();
}
