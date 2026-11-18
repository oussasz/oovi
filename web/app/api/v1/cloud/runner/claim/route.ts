// Runner only (header x-oovi-runner): the next job of any account that syncs, when no desktop of that account
// is online and it waited 5 s. Never a job left for the computer.
import { claimForRunner } from "@/lib/cloud";
import { isId } from "@/lib/cloud-core";
import { body, fail, guarded, ok, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const b = await body(req, 4096);
  if (b === "too_big" || b === "bad" || !isId(b.runnerId)) return fail(400, "bad_request", "runnerId is missing or invalid.");
  const runnerId = b.runnerId;
  return guarded("runner.claim", async () => ok({ job: await claimForRunner(runnerId) }));
}
