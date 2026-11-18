// Runner only: gives a claimed job back to the queue (the runner is stopping, or can't take it now). The next
// claim (a desktop or another runner) runs it again from the start of its message. 409 = not this runner's lease.
import { releaseJob } from "@/lib/cloud";
import { isId, isUuid } from "@/lib/cloud-core";
import { body, fail, guarded, ok, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { jobId } = await params;
  if (!isUuid(jobId)) return fail(400, "bad_request", "Invalid job id.");
  const b = await body(req, 4096);
  if (b === "too_big" || b === "bad" || !isId(b.runnerId)) return fail(400, "bad_request", "runnerId is missing or invalid.");
  const runnerId = b.runnerId;
  return guarded("runner.release", async () => ((await releaseJob(jobId, `runner:${runnerId}`)) ? ok({ ok: true }) : fail(409, "conflict", "This job's lease was lost: another device took it, or it ended.")));
}
