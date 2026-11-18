// The desktop app keeps its claim on a job (+120 s). 409 = the lease was lost.
import { isUuid } from "@/lib/cloud-core";
import { jobHeartbeat } from "@/lib/cloud-handlers";
import { fail, guarded, signedIn } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const who = await signedIn(req, "claim");
  if (!("userId" in who)) return who;
  const { jobId } = await params;
  if (!isUuid(jobId)) return fail(400, "bad_request", "Invalid job id.");
  return guarded("jobs.heartbeat", () => jobHeartbeat(req, jobId, "desktop", who.userId));
}
