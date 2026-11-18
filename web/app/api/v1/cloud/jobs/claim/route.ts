// The desktop app claims its account's next job (atomic, 120 s lease). A phone never claims.
import { claimForDesktop } from "@/lib/cloud";
import { checkClaim } from "@/lib/cloud-core";
import { body, fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const who = await signedIn(req, "claim");
  if (!("userId" in who)) return who;
  const b = await body(req, 256 * 1024);
  if (b === "too_big" || b === "bad") return fail(400, "bad_request", "Invalid request.");
  const v = checkClaim(b);
  if (typeof v === "string") return fail(400, "bad_request", v);
  return guarded("jobs.claim", async () => {
    const r = await claimForDesktop(who.userId, v.deviceId, v.chatIds);
    if (r && "off" in r) return syncOff();
    return ok({ job: r });
  });
}
