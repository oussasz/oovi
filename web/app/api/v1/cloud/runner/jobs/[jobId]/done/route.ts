// Runner only: ends its claim (done, failed, or needs_computer: the desktop picks it up when it opens).
import { isUuid } from "@/lib/cloud-core";
import { jobDone } from "@/lib/cloud-handlers";
import { fail, guarded, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { jobId } = await params;
  if (!isUuid(jobId)) return fail(400, "bad_request", "Invalid job id.");
  return guarded("runner.done", () => jobDone(req, jobId, "runner", null));
}
