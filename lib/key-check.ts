// Checks an AI provider's key (or a local server's address) before oovi calls it "connected": a light request
// that needs the key (the list of models; OpenRouter's key page), never a paid generation.
import { PROVIDERS, type ProviderId } from "./providers-meta";

export type KeyCheck = { ok: true } | { ok: false; error: string };

export async function checkProviderKey(p: ProviderId, apiKey: string, baseUrlIn: string): Promise<KeyCheck> {
  const meta = PROVIDERS[p];
  const base = (baseUrlIn || meta.baseUrl).replace(/\/+$/, "");
  if (p === "oovi") return { ok: true };
  if (!base) return { ok: false, error: "Enter the server's address." };
  let url: string;
  const headers: Record<string, string> = {};
  if (meta.kind === "anthropic") {
    url = `${base}/v1/models`;
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    // OpenRouter lists its models without a key: its key page needs one.
    url = p === "openrouter" ? `${base}/key` : `${base}/models`;
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, error: `${meta.label} refused this key. Check that you copied all of it, and that it is still active.` };
    if (r.status === 400 && meta.needsKey) {
      const t = (await r.text().catch(() => "")).slice(0, 300);
      if (/key|auth|credential|invalid/i.test(t)) return { ok: false, error: `${meta.label} refused this key. Check that you copied all of it, and that it is still active.` };
    }
    // Anything else answered: the address works (some servers have no model list).
    return { ok: true };
  } catch {
    return { ok: false, error: `Couldn't reach ${meta.label}${meta.needsKey ? "" : ` at ${base}`}. Check the address and your internet, then try again.` };
  }
}
