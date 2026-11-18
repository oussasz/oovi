// The microphone in the chat: POST the recorded audio (raw body, Content-Type audio/…), get its text back
// to check and send (lib/voice.ts).
import { guard } from "@/lib/guard";
import { MAX_VOICE_BYTES, transcribeAudio } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const mime = req.headers.get("content-type") ?? "";
  if (!/^(audio|video)\/(webm|ogg|mp4|mpeg|wav|opus)/i.test(mime)) return Response.json({ error: "Send audio." }, { status: 400 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_VOICE_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
  const r = await transcribeAudio(buf, mime);
  if ("error" in r) return Response.json(r, { status: 502 });
  return Response.json(r);
}
