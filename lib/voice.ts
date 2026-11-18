// Voice notes to text: a Telegram voice message or the app's microphone. With the user's own OpenAI or Groq
// key the audio goes straight there; otherwise through the oovi server (credits, web/app/api/v1/ai/transcribe).
// Darija, Arabic, French and English are recognized as spoken (no language is forced).
import { cloud, sessionToken } from "./account";
import { loadSettings } from "./settings";

export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

export type Transcript = { text: string } | { error: string };

const DIRECT: { provider: "groq" | "openai"; url: string; model: string }[] = [
  { provider: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3" },
  { provider: "openai", url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
];

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/opus": "ogg", "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "video/webm": "webm" };

export async function transcribeAudio(audio: Buffer, mime: string): Promise<Transcript> {
  if (!audio.length) return { error: "The voice note is empty." };
  if (audio.length > MAX_VOICE_BYTES) return { error: "That voice note is too long (20 MB at most)." };
  const type = mime.split(";")[0]!.trim().toLowerCase();
  const s = loadSettings();
  // The user's own key first (no credits), when they set one up.
  for (const d of DIRECT) {
    const key = s.providers[d.provider]?.apiKey;
    if (!key) continue;
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type }), `voice.${EXT[type] ?? "ogg"}`);
      form.append("model", d.model);
      form.append("temperature", "0");
      const r = await fetch(d.url, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(90_000) });
      const j = (await r.json().catch(() => null)) as { text?: string } | null;
      if (r.ok && typeof j?.text === "string") return { text: j.text.trim() };
    } catch {
      /* next way */
    }
  }
  if (!sessionToken()) return { error: "Sign in to oovi to send voice notes (or add an OpenAI or Groq key in Settings > AI models)." };
  try {
    const r = await cloud<{ text: string }>("/api/v1/ai/transcribe", { method: "POST", auth: true, body: { audio: audio.toString("base64"), mime: type } });
    return { text: String(r?.text ?? "").trim() };
  } catch (e) {
    return { error: (e as Error).message || "The voice note couldn't be turned into text." };
  }
}

/** How a transcribed voice note is written in the chat (the bot knows it was spoken, so small slips are expected). */
export const voiceText = (text: string) => `🎤 ${text}`;
