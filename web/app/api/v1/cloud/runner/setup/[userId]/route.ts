// Runner only: the oovi setup (bots, groups, skills, routines, connectors without keys, memory) of the account whose
// job the runner runs, exactly like /api/v1/setup. PUT: what the job changed (memory, a routine, a lesson) goes back.
// Only for accounts that sync.
import { MAX_SETUP_BYTES, readSetup, writeSetup } from "@/lib/account-setup";
import { isEnabled } from "@/lib/cloud";
import { isUserId } from "@/lib/cloud-core";
import { fail, guarded, ok, runnerOnly, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ userId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  return guarded("runner.setup.get", async () => ((await isEnabled(userId)) ? ok(await readSetup(userId)) : syncOff()));
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  let b: { baseVersion?: unknown; items?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_SETUP_BYTES) return fail(413, "too_big", "The setup is too big to keep (over 8 MB).");
    b = JSON.parse(text) as typeof b;
  } catch {
    return fail(400, "bad_request", "Invalid request.");
  }
  const base = Number(b.baseVersion);
  const items = b.items;
  if (!Number.isInteger(base) || base < 0 || !items || typeof items !== "object" || Array.isArray(items)) return fail(400, "bad_request", "Invalid request.");
  if (Object.keys(items).length > 20_000 || Object.keys(items).some((k) => !/^[a-z]+(:[\w.-]{1,100})?$/.test(k))) return fail(400, "bad_request", "Invalid setup.");
  return guarded("runner.setup.put", async () => {
    if (!(await isEnabled(userId))) return syncOff();
    const r = await writeSetup(userId, base, items as Record<string, unknown>);
    return r === "conflict" ? fail(409, "conflict", "The setup changed on another computer.") : ok(r);
  });
}
