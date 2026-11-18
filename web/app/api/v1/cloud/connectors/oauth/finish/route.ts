// The app finishes a sign-in that came back to another browser (GET /vault lists it as waiting_finish). Only the
// account AND session that started it; once. Answers the connector's vault entry {connectorId, version, data}.
import { isUuid } from "@/lib/cloud-core";
import { finishHeld } from "@/lib/cloud-oauth";
import { body, fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const who = await signedIn(req, "oauth");
  if (!("userId" in who)) return who;
  const b = await body(req, 4096);
  if (b === "bad" || b === "too_big" || !isUuid(b.flowId)) return fail(400, "bad_request", "flowId is missing or invalid.");
  const flowId = b.flowId;
  return guarded("connectors.oauth.finish", async () => {
    const r = await finishHeld(who.userId, who.sessionId, flowId);
    if (!("error" in r)) return ok(r);
    if (r.error === "not_found") return fail(404, "not_found", "This sign-in isn't waiting here (another device started it, or it was finished).");
    if (r.error === "expired") return fail(410, "not_found", "This sign-in expired. Start it again.");
    if (r.error === "not_back") return fail(409, "conflict", "The sign-in hasn't come back yet.");
    if (r.error === "not_confirmed") return fail(409, "conflict", "Confirm your account on the sign-in page first.");
    if (r.error === "sync_off") return syncOff();
    return fail(502, "unavailable", "The service refused the sign-in. Try connecting again.");
  });
}
