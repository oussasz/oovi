// Client-side view of the user's models (mirrors enabledModels / modelChain in llm.ts).
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "./providers-meta";
import type { ModelRef, PublicSettings } from "./settings";

export type Price = { input: number; output: number };
export type ModelInfo = { id: string; name?: string; free?: boolean; tools?: boolean; context?: number; price?: Price };

export const refKey = (r: ModelRef) => `${r.provider}:${r.model}`;
export const sameRef = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.model === b.model;

/** Has a key, or needs none and was set up. */
export function isConnected(s: PublicSettings, p: ProviderId): boolean {
  const cfg = s.providers[p];
  if (!cfg) return false;
  return PROVIDERS[p].needsKey ? cfg.hasKey : !!(cfg.models?.length || cfg.model || cfg.baseUrl);
}

/** The models switched on for one provider. */
export function providerModels(s: PublicSettings, p: ProviderId): string[] {
  const cfg = s.providers[p];
  if (!cfg) return [];
  return cfg.models ?? [cfg.model || PROVIDERS[p].model].filter(Boolean);
}

/** Every switched-on model, across connected providers. */
export function enabledRefs(s: PublicSettings): ModelRef[] {
  const out: ModelRef[] = [];
  for (const p of PROVIDER_IDS) if (isConnected(s, p)) for (const m of providerModels(s, p)) out.push({ provider: p, model: m });
  return out;
}

/** The order oovi tries models in: main, backups, then the rest. */
export function chainOf(s: PublicSettings): ModelRef[] {
  const all = enabledRefs(s);
  const out: ModelRef[] = [];
  const main: ModelRef = { provider: s.active, model: s.providers[s.active]?.model || PROVIDERS[s.active].model };
  for (const r of [main, ...s.fallbacks, ...all]) {
    if (all.some((x) => sameRef(x, r)) && !out.some((x) => sameRef(x, r))) out.push(r);
  }
  return out;
}

/** "Free", or "$3 / $15 per 1M tokens" (input / output). */
export function priceText(info: ModelInfo | undefined, labels: { free: string; perM: string }): string {
  if (!info) return "";
  if (info.free) return labels.free;
  if (!info.price) return "";
  const f = (n: number) => (n === 0 ? "0" : n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2).replace(/\.00$/, "") : n.toFixed(0));
  return `$${f(info.price.input)} / $${f(info.price.output)} ${labels.perM}`;
}
