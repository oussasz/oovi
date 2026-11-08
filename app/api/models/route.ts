import { guard } from "@/lib/guard";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ModelInfo = { id: string; name?: string; free?: boolean; tools?: boolean; context?: number };

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Live model list for a provider, so people pick real model names instead of guessing. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const p = new URL(req.url).searchParams.get("provider") as ProviderId | null;
  if (!p || !(p in PROVIDERS)) return Response.json({ error: "Unknown provider." }, { status: 400 });

  const meta = PROVIDERS[p];
  const cfg = loadSettings().providers[p] ?? {};
  const base = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, "");
  if (!base) return Response.json({ error: "Set a base URL first." }, { status: 400 });

  try {
    let models: ModelInfo[];
    if (p === "openrouter") {
      // Public list: works without a key. Marks free models and tool support.
      const j = (await fetchJson(`${base}/models`, {})) as {
        data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[];
      };
      models = (j.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
        free: Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0,
        tools: (m.supported_parameters ?? []).includes("tools"),
      }));
    } else if (meta.kind === "anthropic") {
      if (!cfg.apiKey) throw new Error(`Add your ${meta.label} key first.`);
      const j = (await fetchJson(`${base}/v1/models?limit=100`, { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" })) as { data?: { id: string; display_name?: string }[] };
      models = (j.data ?? []).map((m) => ({ id: m.id, name: m.display_name, tools: true }));
    } else {
      if (meta.needsKey && !cfg.apiKey) throw new Error(`Add your ${meta.label} key first.`);
      const j = (await fetchJson(`${base}/models`, cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})) as { data?: { id: string }[] };
      models = (j.data ?? []).map((m) => ({ id: m.id.replace(/^models\//, "") }));
      if (p === "gemini") {
        models = models
          .filter((m) => /gemini/.test(m.id) && !/embedding|tts|image|audio|live|aqa|robotics|computer-use/.test(m.id))
          .map((m) => ({ ...m, free: true, tools: true }));
      }
    }
    models.sort((a, b) => Number(!!b.free) - Number(!!a.free) || Number(b.tools !== false) - Number(a.tools !== false) || a.id.localeCompare(b.id));
    return Response.json({ models });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
