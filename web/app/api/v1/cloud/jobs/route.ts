// The phone sends work for a synced chat: a message, an approval answer, or Stop. The desktop app or the cloud
// runner claims it (docs/CLOUD-BUILD.md "Who runs a job").
import { createJob } from "@/lib/cloud";
import { MAX_JOB_TEXT, checkJobCreate, MAX_OPEN_JOBS } from "@/lib/cloud-core";
import { body, fail, guarded, notFound, ok, signedIn, syncOff } from "@/lib/cloud-route";
import { clientIp } from "@/lib/api";
import { ensureAccount } from "@/lib/credits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const who = await signedIn(req, "job");
  if (!("userId" in who)) return who;
  const b = await body(req, MAX_JOB_TEXT);
  if (b === "too_big") return fail(413, "too_big", "This message is too big to send.");
  if (b === "bad") return fail(400, "bad_request", "Invalid request.");
  const v = checkJobCreate(b);
  if (typeof v === "string") return fail(400, "bad_request", v);
  return guarded("jobs.create", async () => {
    const r = await createJob(who.userId, v.chatId, v.kind, v.payload);
    if ("off" in r) return syncOff();
    if ("noChat" in r) return notFound();
    if ("tooMany" in r) return fail(429, "busy", `${MAX_OPEN_JOBS} tasks are already waiting. Open oovi on your computer, or wait for them to finish.`);
    // theOovi credits set up from the person's own address (the cloud runner bills them and never sends an address).
    await ensureAccount(who.userId, clientIp(req)).catch(() => {});
    return ok(r);
  });
}
