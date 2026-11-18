// Runner only (header x-oovi-runner): the next job of any account that syncs, when no desktop of that account
// is online and it waited 5 s. Never a job left for the computer.
import { claimForRunner } from "@/lib/cloud";
import { isId, isUserId } from "@/lib/cloud-core";
import { body, fail, guarded, ok, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const b = await body(req, 4096);
  if (b === "too_big" || b === "bad" || !isId(b.runnerId)) return fail(400, "bad_request", "runnerId is missing or invalid.");
  const runnerId = b.runnerId;
  // Accounts that already have a job on this runner (fairness): their next job waits for another runner or a moment.
  const exclude = Array.isArray(b.exclude) ? b.exclude.filter(isUserId).slice(0, 64) : [];
  return guarded("runner.claim", async () => ok({ job: await claimForRunner(runnerId, exclude) }));
}
