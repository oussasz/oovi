// The phone waits for a chat's next version (long-poll, up to 25 s): it answers as soon as the chat's version
// is above `after`, or one of its jobs changed after `jobsAfter`; otherwise changed=false after 25 s.
import { chatEvent, isEnabled } from "@/lib/cloud";
import { LONG_POLL_MS, isId, parseSince } from "@/lib/cloud-core";
import { fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 40;

const STEP_MS = 1500;

export async function GET(req: Request) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  const q = new URL(req.url).searchParams;
  const chatId = q.get("chatId");
  const after = Number(q.get("after") ?? "0");
  const jobsAfter = parseSince(q.get("jobsAfter"));
  if (!isId(chatId) || !Number.isInteger(after) || after < 0 || jobsAfter === "bad") {
    return fail(400, "bad_request", "Send chatId, after (a version) and optionally jobsAfter (a date).");
  }
  // Test-only shortening (never set in production): the end-to-end test doesn't wait 25 s.
  const waitMs = Math.min(LONG_POLL_MS, Number(process.env.OOVI_CLOUD_POLL_MS) || LONG_POLL_MS);
  return guarded("events", async () => {
    if (!(await isEnabled(who.userId))) return syncOff();
    const end = Date.now() + waitMs;
    for (;;) {
      const e = await chatEvent(who.userId, chatId, jobsAfter);
      const changed = e.version > after || e.jobsChanged;
      if (changed || Date.now() + STEP_MS > end || req.signal.aborted) {
        return ok({ chatId, changed, version: e.version, deleted: e.deleted, updatedAt: e.updatedAt, jobs: e.jobs, now: new Date().toISOString() });
      }
      await new Promise((r) => setTimeout(r, STEP_MS));
    }
  });
}
