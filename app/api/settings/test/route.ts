import { guard } from "@/lib/guard";
import { complete } from "@/lib/llm";
import { PROVIDERS } from "@/lib/providers-meta";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends a tiny prompt to the active provider to check the key, URL and model. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const s = loadSettings();
  const started = Date.now();
  try {
    const out = await complete(s, "You are a connection test.", [{ role: "user", content: "Reply with the single word OK." }], [], AbortSignal.timeout(30_000));
    return Response.json({ ok: true, provider: PROVIDERS[s.active].label, model: out.model + (out.fallback ? " (backup)" : ""), reply: out.text.slice(0, 200), ms: Date.now() - started });
  } catch (e) {
    return Response.json({ ok: false, provider: PROVIDERS[s.active].label, error: (e as Error).message });
  }
}
