// The account's connectors kept in the cloud (settings and sign-ins): ids and versions only, plus sign-ins waiting
// to be finished (pending).
import { listVault } from "@/lib/cloud";
import { guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";
import { pendingSignIns } from "@/lib/cloud-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  return guarded("vault.list", async () => {
    const r = await listVault(who.userId);
    if ("off" in r) return syncOff();
    // Sign-ins that came back to another browser: the app finishes those with here=true on focus.
    return ok({ items: r, pending: await pendingSignIns(who.userId, who.sessionId) });
  });
}
