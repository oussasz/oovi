// The desktop app: its routines that may run on the cloud server while it is off, and when each runs next (replaces
// the account's list). Answers what the cloud already ran, so the desktop marks those done before catching up.
// docs/CLOUD-BUILD.md "Changes" 2026-11-19 (routines while the computer is off).
import { putRoutines, type RoutineItem } from "@/lib/cloud";
import { isId } from "@/lib/cloud-core";
import { body, fail, guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTINE_ID = /^[\w-]{1,64}$/;

export async function PUT(req: Request) {
  const who = await signedIn(req, "claim");
  if (!("userId" in who)) return who;
  const b = await body(req, 64 * 1024);
  if (b === "too_big" || b === "bad" || !isId(b.deviceId) || !Array.isArray(b.items) || b.items.length > 200) return fail(400, "bad_request", "deviceId and items are needed.");
  const items: RoutineItem[] = [];
  for (const x of b.items as unknown[]) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const due = o.dueAt === null ? null : typeof o.dueAt === "string" && !Number.isNaN(Date.parse(o.dueAt)) ? new Date(o.dueAt).toISOString() : undefined;
    if (typeof o.routineId !== "string" || !ROUTINE_ID.test(o.routineId) || !isId(o.chatId) || due === undefined) return fail(400, "bad_request", "Each item needs routineId, chatId and dueAt.");
    const tz = typeof o.timeZone === "string" && /^[A-Za-z_+\-/0-9]{1,64}$/.test(o.timeZone) ? o.timeZone : null;
    const why = typeof o.why === "string" && /^[a-z]{1,16}$/.test(o.why) ? o.why : null;
    const name = typeof o.name === "string" ? o.name.slice(0, 120) : "";
    items.push({ routineId: o.routineId, chatId: o.chatId, dueAt: due, timeZone: tz, cloud: o.cloud !== false, why, name });
  }
  const deviceId = b.deviceId;
  return guarded("routines.put", async () => {
    const r = await putRoutines(who.userId, deviceId, items);
    if ("off" in r) return syncOff();
    return ok({ items: r });
  });
}
