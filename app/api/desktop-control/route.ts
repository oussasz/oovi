import { desktopState, revokeAllDesktop } from "@/lib/desktop-control";
import { guard } from "@/lib/guard";
import { hostedStatus } from "@/lib/hosted";
import { loadSettings, setDesktopControl, usesHosted } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function state() {
  const s = loadSettings();
  // theOovi says whether its model can control the desktop.
  if (usesHosted(s)) await hostedStatus().catch(() => null);
  return desktopState(s);
}

/** "Control this computer (Beta)" (Settings > Safety): whether it can work here, and the user's choices. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await state());
}

/** {enabled: true, consent: true} | {enabled: false} | {askEvery: boolean} */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown; consent?: unknown; askEvery?: unknown } | null;
  const cur = loadSettings().desktopControl;
  if (body?.enabled === true) {
    if (process.platform !== "win32") return Response.json({ error: "Desktop control is only available on Windows for now." }, { status: 400 });
    if (body.consent !== true) return Response.json({ error: "Tick the box to confirm you understand the risks first." }, { status: 400 });
    setDesktopControl({ ...cur, enabled: true, consentAt: Date.now() });
  } else if (body?.enabled === false) {
    setDesktopControl({ ...cur, enabled: false });
    revokeAllDesktop();
  } else if (typeof body?.askEvery === "boolean") {
    setDesktopControl({ ...cur, askEvery: body.askEvery });
  } else {
    return Response.json({ error: "Send {enabled, consent} or {askEvery}." }, { status: 400 });
  }
  return Response.json(await state());
}
