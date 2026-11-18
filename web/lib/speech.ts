// Speech to text for voice notes (Telegram voice messages, the app's microphone): the audio goes to a
// speech provider with oovi's own key, and the words come back. Groq (Whisper large v3) or OpenAI, chosen
// by the key saved in Admin > theOovi > Voice notes (or GROQ_API_KEY / OPENAI_API_KEY on the server).
// Nothing is kept: neither the audio nor the text.
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";

export type SttProvider = "groq" | "openai";
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Cost per minute of audio in US dollars (list prices, rounded up), to charge credits at cost. */
export const PER_MINUTE_USD: Record<SttProvider, number> = { groq: 0.002, openai: 0.006 };
const ENDPOINT: Record<SttProvider, { url: string; model: string }> = {
  groq: { url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3" },
  openai: { url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
};

export const providerOfKey = (key: string): SttProvider | null => (/^gsk_\w{20,}$/.test(key) ? "groq" : /^sk-[\w-]{20,}$/.test(key) ? "openai" : null);

const g = globalThis as typeof globalThis & { __ooviStt?: { v: { key: string; provider: SttProvider } | null; at: number } };

/** The key to use, or null when voice notes aren't set up. Server-only. */
export async function sttKey(): Promise<{ key: string; provider: SttProvider } | null> {
  const c = g.__ooviStt;
  if (c && Date.now() - c.at < 15_000) return c.v;
  let v: { key: string; provider: SttProvider } | null = null;
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'stt_secret'");
    const s = rows[0]?.value as Sealed | undefined;
    if (s?.data) {
      const key = unsealSecret(s);
      const provider = providerOfKey(key);
      if (provider) v = { key, provider };
    }
  } catch (err) {
    console.error("stt key read failed", err instanceof Error ? err.message : "unknown error");
  }
  if (!v && process.env.GROQ_API_KEY) v = { key: process.env.GROQ_API_KEY, provider: "groq" };
  if (!v && process.env.OPENAI_API_KEY) v = { key: process.env.OPENAI_API_KEY, provider: "openai" };
  g.__ooviStt = { v, at: Date.now() };
  return v;
}

export async function saveSttKey(key: string | null, by: string): Promise<void> {
  if (key === null) await pool.query("DELETE FROM app_config WHERE key = 'stt_secret'");
  else
    await pool.query(
      `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('stt_secret', $1::jsonb, now(), $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(sealSecret(key)), by],
    );
  g.__ooviStt = undefined;
}

export async function sttKeyInfo(): Promise<{ provider: SttProvider | null; hint: string | null; source: "console" | "env" | "none" }> {
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'stt_secret'");
    const s = rows[0]?.value as Sealed | undefined;
    if (s?.data) {
      const k = unsealSecret(s);
      return { provider: providerOfKey(k), hint: `…${k.slice(-4)}`, source: "console" };
    }
  } catch {
    /* falls through to the server's environment */
  }
  if (process.env.GROQ_API_KEY) return { provider: "groq", hint: `…${process.env.GROQ_API_KEY.slice(-4)}`, source: "env" };
  if (process.env.OPENAI_API_KEY) return { provider: "openai", hint: `…${process.env.OPENAI_API_KEY.slice(-4)}`, source: "env" };
  return { provider: null, hint: null, source: "none" };
}

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/opus": "ogg", "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "video/webm": "webm" };

/** The words in the audio, and how long it was (seconds). */
export async function transcribe(audio: Buffer, mime: string, k: { key: string; provider: SttProvider }): Promise<{ text: string; seconds: number }> {
  const ep = ENDPOINT[k.provider];
  const form = new FormData();
  const type = mime.split(";")[0]!.trim().toLowerCase();
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `voice.${EXT[type] ?? "ogg"}`);
  form.append("model", ep.model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  const r = await fetch(ep.url, { method: "POST", headers: { authorization: `Bearer ${k.key}` }, body: form, signal: AbortSignal.timeout(90_000) });
  const j = (await r.json().catch(() => null)) as { text?: string; duration?: number; error?: { message?: string } } | null;
  if (!r.ok) throw new Error(j?.error?.message?.slice(0, 200) || `Speech service error ${r.status}`);
  return { text: String(j?.text ?? "").trim(), seconds: Number(j?.duration) || Math.max(1, audio.length / 4000) };
}
