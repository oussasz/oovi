// Runner only (header x-oovi-runner): a message to the account's own Telegram (a routine's result while the computer
// is off). The token stays here (lib/telegram-relay.ts); the runner never gets it.
import { isUserId } from "@/lib/cloud-core";
import { body, fail, guarded, ok, runnerFor, runnerOnly } from "@/lib/cloud-route";
import { sendToOwner } from "@/lib/telegram-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const b = await body(req, 32_768);
  if (b === "too_big" || b === "bad" || !isUserId(b.userId) || typeof b.text !== "string" || !b.text.trim()) return fail(400, "bad_request", "userId and text are needed.");
  const userId = b.userId;
  // Only while a runner holds a job of this account (lib/cloud-route.ts runnerFor).
  const closed = await runnerFor(userId);
  if (closed) return closed;
  const text = b.text.slice(0, 20_000);
  return guarded("runner.telegram", async () => ok({ sent: await sendToOwner(userId, text) }));
}
