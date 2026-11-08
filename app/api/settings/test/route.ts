import { guard } from "@/lib/guard";
import { complete } from "@/lib/llm";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a tiny prompt to check a key, address and model.
 * Body {provider, model} tests exactly that model (no backups); no body tests the main model chain.
 */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { provider?: unknown; model?: unknown } | null;
  const s = loadSettings();
  const only = typeof body?.provider === "string" && body.provider in PROVIDERS && typeof body.model === "string" && body.model.trim();
  if (only) {
    const p = body!.provider as ProviderId;
    const model = String(body!.model).trim();
    // Just this model: no backups, so the result says whether *it* works.
    s.active = p;
    s.providers = { [p]: { ...s.providers[p], model, models: [model] } };
    s.fallbacks = [];
  }
  const started = Date.now();
  try {
    const out = await complete(s, "You are a connection test.", [{ role: "user", content: "Reply with the single word OK." }], [], AbortSignal.timeout(30_000));
    return Response.json({ ok: true, provider: PROVIDERS[out.ref.provider].label, model: out.model + (out.fallback ? " (backup)" : ""), reply: out.text.slice(0, 200), ms: Date.now() - started, note: out.note });
  } catch (e) {
    return Response.json({ ok: false, provider: PROVIDERS[s.active].label, error: (e as Error).message });
  }
}
