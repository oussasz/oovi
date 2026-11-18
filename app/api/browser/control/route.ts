import { peekSession } from "@/lib/browser";
import { liveInfo, liveTarget, releaseControl, startRecording, stopRecording, takeControl } from "@/lib/browser-live";
import { describeSteps, skillFromSteps } from "@/lib/teach-core";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST {chat, bot, action}: "take" | "release" (the user takes over a bot's browser, or hands it back),
 * "record" (note the user's steps from now on) | "stopRecord" (the steps, and a skill drafted from them).
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { chat?: unknown; bot?: unknown; action?: unknown } | null;
  const target = liveTarget(body?.chat, body?.bot);
  if (target instanceof Response) return target;
  const { sessionId } = target;
  if (body?.action === "take") {
    if (!takeControl(sessionId)) return Response.json({ error: "The bot's browser is closed." }, { status: 404 });
  } else if (body?.action === "release") {
    if (!peekSession(sessionId)) return Response.json({ error: "The bot's browser is closed." }, { status: 404 });
    releaseControl(sessionId);
  } else if (body?.action === "record") {
    if (!startRecording(sessionId)) return Response.json({ error: "Take control of the browser first." }, { status: 409 });
  } else if (body?.action === "stopRecord") {
    const steps = await stopRecording(sessionId);
    if (!steps) return Response.json({ error: "Nothing was being recorded." }, { status: 409 });
    return Response.json({ ...liveInfo(sessionId), steps: describeSteps(steps), draft: skillFromSteps(steps, "") });
  } else {
    return Response.json({ error: "action must be take, release, record or stopRecord." }, { status: 400 });
  }
  return Response.json(liveInfo(sessionId));
}
