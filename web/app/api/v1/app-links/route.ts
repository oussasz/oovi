// POST {purpose: "pilot"} → {url}: a short-lived, single-use link to that page of the website for the signed-in
// account (lib/app-links.ts). For the apps (desktop with its token, phone with its session): the website itself has
// no sign-in any more.
import { apiError, getRequestSession, json, rateLimit, readJson } from "@/lib/api";
import { APP_LINK_PURPOSES, createAppLink, type AppLinkPurpose } from "@/lib/app-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATHS: Record<AppLinkPurpose, string> = { pilot: "/pilot" };

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return apiError("Forbidden origin.", 403);
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`applink:${session.user.id}`, 20, 10 * 60_000)) return apiError("Too many links at once. Try again in a few minutes.", 429);
  const body = await readJson(req, 1024);
  const purpose = APP_LINK_PURPOSES.find((p) => p === body?.purpose);
  if (!purpose) return apiError("Unknown purpose.", 400);
  try {
    const token = await createAppLink(session.user.id, purpose);
    return json({ url: new URL(`${PATHS[purpose]}?t=${token}`, req.url).toString() });
  } catch (err) {
    console.error("app link failed", err instanceof Error ? err.message : err);
    return apiError("Couldn't make the link right now.", 503);
  }
}
