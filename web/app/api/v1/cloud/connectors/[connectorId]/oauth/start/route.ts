// The phone starts a connector's sign-in (OAuth). Answers {authUrl}: the phone opens it; the service comes back to
// /api/v1/cloud/connectors/oauth/callback. Body: {url?} (only used when the connector's vault entry has no url).
import { isId } from "@/lib/cloud-core";
import { startCloudSignIn } from "@/lib/cloud-oauth";
import { body, fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const who = await signedIn(req, "oauth");
  if (!("userId" in who)) return who;
  const { connectorId } = await params;
  if (!isId(connectorId)) return fail(400, "bad_request", "Invalid connector id.");
  const b = await body(req, 8192);
  const url = b === "bad" || b === "too_big" ? undefined : b.url;
  return guarded("connectors.oauth.start", async () => {
    const r = await startCloudSignIn(who.userId, who.sessionId, connectorId, url);
    if ("authUrl" in r) return ok(r);
    if (r.error === "sync_off") return syncOff();
    if (r.error === "too_many") return fail(429, "busy", r.message);
    if (r.error === "failed") return fail(502, "unavailable", r.message);
    return fail(400, "bad_request", r.message);
  });
}
