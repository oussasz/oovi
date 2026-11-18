// The account's synced chats, without content: ids, versions, sizes, tombstones (docs/CLOUD-BUILD.md).
import { listChats } from "@/lib/cloud";
import { parseSince } from "@/lib/cloud-core";
import { fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  const since = parseSince(new URL(req.url).searchParams.get("since"));
  if (since === "bad") return fail(400, "bad_request", "since must be a date (ISO 8601).");
  return guarded("chats.list", async () => {
    const r = await listChats(who.userId, since);
    return "off" in r ? syncOff() : ok(r);
  });
}
