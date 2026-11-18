// The desktop app ends its claim: done, failed, or needs_computer (left for later).
import { isUuid } from "@/lib/cloud-core";
import { jobDone } from "@/lib/cloud-handlers";
import { fail, guarded, signedIn } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const who = await signedIn(req, "claim");
  if (!("userId" in who)) return who;
  const { jobId } = await params;
  if (!isUuid(jobId)) return fail(400, "bad_request", "Invalid job id.");
  return guarded("jobs.done", () => jobDone(req, jobId, "desktop", who.userId));
}
