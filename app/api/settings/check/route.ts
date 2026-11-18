// POST {provider, apiKey?, baseUrl?}: is this key (or address) accepted? Used before a provider shows "Connected".
import { guard } from "@/lib/guard";
import { checkProviderKey } from "@/lib/key-check";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { provider?: unknown; apiKey?: unknown; baseUrl?: unknown } | null;
  const p = String(b?.provider ?? "") as ProviderId;
  if (!(p in PROVIDERS)) return Response.json({ ok: false, error: "Unknown provider." }, { status: 400 });
  const saved = loadSettings().providers[p];
  // A new key wins; without one, the saved key (changing only the address).
  const apiKey = typeof b?.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : (saved?.apiKey ?? "");
  const baseUrl = typeof b?.baseUrl === "string" ? b.baseUrl.trim() : (saved?.baseUrl ?? "");
  if (PROVIDERS[p].needsKey && !apiKey) return Response.json({ ok: false, error: "Paste the key first." });
  return Response.json(await checkProviderKey(p, apiKey, baseUrl));
}
