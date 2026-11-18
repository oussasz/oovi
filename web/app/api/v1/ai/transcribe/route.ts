// A voice note to text, for the user's oovi (lib/speech.ts). Body: {audio: base64, mime}. Charged in credits
// at cost (a few credits a minute). Refused when theOovi can't be used by this account right now.
import { apiError, clientIp, getRequestSession, rateLimit } from "@/lib/api";
import { getAiConfig } from "@/lib/ai-config";
import { adjustCredits, creditStatus } from "@/lib/credits";
import { MAX_AUDIO_BYTES, PER_MINUTE_USD, sttKey, transcribe } from "@/lib/speech";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const AUDIO = /^(audio\/(ogg|opus|webm|mpeg|mp4|x-m4a|wav|x-wav)|video\/webm)(;.*)?$/i;

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`stt:${session.user.id}`, 30, 60_000)) return apiError("Too many voice notes at once. Wait a minute.", 429);
  const b = (await req.json().catch(() => null)) as { audio?: unknown; mime?: unknown } | null;
  const mime = typeof b?.mime === "string" ? b.mime.slice(0, 80) : "";
  if (!AUDIO.test(mime) || typeof b?.audio !== "string") return apiError("Send {audio: base64, mime: audio/…}.", 400);
  const audio = Buffer.from(b.audio, "base64");
  if (!audio.length) return apiError("The audio is empty.", 400);
  if (audio.length > MAX_AUDIO_BYTES) return apiError("That voice note is too long (20 MB at most).", 413);
  const k = await sttKey();
  if (!k) return apiError("Voice notes aren't available yet.", 503);
  const u = session.user as { id: string; createdAt: Date | string; emailVerified?: boolean };
  const st = await creditStatus(u.id, u.createdAt, clientIp(req), u.emailVerified !== false);
  if (st.state !== "ok") return apiError(st.message ?? "theOovi can't be used right now.", 402);
  let out: { text: string; seconds: number };
  try {
    out = await transcribe(audio, mime, k);
  } catch (err) {
    console.error("transcribe failed", err instanceof Error ? err.message : err);
    return apiError("The voice note couldn't be turned into text. Try again, or type the message.", 502);
  }
  const cfg = await getAiConfig();
  const credits = Math.max(0.1, Math.round(((out.seconds / 60) * PER_MINUTE_USD[k.provider] * cfg.creditsPerUsd) * 10) / 10);
  await adjustCredits(u.id, -credits, "transcribe", `voice note ${Math.round(out.seconds)} s`, null).catch(() => {});
  return Response.json({ text: out.text, seconds: Math.round(out.seconds), credits }, { headers: { "cache-control": "no-store" } });
}
