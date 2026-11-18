// Cloud sync (lib/cloud-sync.ts) for the app's screens: Settings > Sync, the one-time question, the first run.
import { guard } from "@/lib/guard";
import { answerCloudQuestion, cloudStatus, setCloudSync, syncCloud } from "@/lib/cloud-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The status: on/off, last sync, problems, the account's size and devices (?fresh=1 asks the account now). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  return Response.json(await cloudStatus(fresh), { headers: { "cache-control": "no-store" } });
}

/**
 * {action: "on" | "off"}: the switch (off deletes the account's copy, after the app asked).
 * {action: "answer", choice: "cloud" | "local"}: the question. {action: "sync"}: sync now (the window got the focus).
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { action?: unknown; choice?: unknown } | null;
  let r: { ok: boolean; problem?: string } = { ok: true };
  if (b?.action === "on" || b?.action === "off") r = await setCloudSync(b.action === "on");
  else if (b?.action === "answer" && (b.choice === "cloud" || b.choice === "local")) r = await answerCloudQuestion(b.choice);
  else if (b?.action === "sync") {
    const s = await cloudStatus();
    if (s.enabled) await Promise.race([syncCloud(), new Promise((ok) => setTimeout(ok, 20_000))]);
  } else return Response.json({ error: "Send {action: on | off | answer | sync}." }, { status: 400 });
  return Response.json({ ...r, status: await cloudStatus() }, { status: r.ok ? 200 : 502 });
}
