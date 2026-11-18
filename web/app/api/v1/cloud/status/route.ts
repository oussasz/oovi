// Cloud sync on/off for the signed-in account, its size and its devices (docs/CLOUD-BUILD.md).
import { getStatus, setEnabled } from "@/lib/cloud";
import { body, fail, guarded, ok, signedIn } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  return guarded("status", async () => ok(await getStatus(who.userId)));
}

/** {enabled}. Off deletes all the account's chats, connector sign-ins and jobs on the server at once. */
export async function PUT(req: Request) {
  const who = await signedIn(req, "status");
  if (!("userId" in who)) return who;
  const b = await body(req, 1024);
  if (b === "too_big" || b === "bad" || typeof b.enabled !== "boolean") return fail(400, "bad_request", "Send {enabled: true} or {enabled: false}.");
  const enabled = b.enabled;
  return guarded("status", async () => {
    await setEnabled(who.userId, enabled);
    return ok(await getStatus(who.userId));
  });
}
