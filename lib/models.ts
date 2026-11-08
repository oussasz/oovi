// Server-only: live model lists, prices, and replacing models a provider has retired.

import fs from "node:fs";
import path from "node:path";
import { baseDir } from "./account";
import { PROVIDERS, type ProviderId } from "./providers-meta";
import type { Settings } from "./settings";

/** price: US dollars per 1 million tokens. */
export type Price = { input: number; output: number };
export type ModelInfo = { id: string; name?: string; free?: boolean; tools?: boolean; context?: number; price?: Price };

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} returned ${r.status}: ${readableError(await r.text())}`);
  return r.json();
}

/** Pull the human message out of a provider's JSON error body. */
export function readableError(body: string): string {
  const text = body.trim();
  try {
    let j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) j = j[0];
    const o = j as { error?: { message?: string } | string; message?: string };
    const e = o?.error;
    const msg = typeof e === "string" ? e : (e?.message ?? o?.message);
    if (msg) return msg.replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    /* not JSON */
  }
  return text.replace(/\s+/g, " ").slice(0, 400);
}

// ---------- model lists ----------

type ORModel = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] };

const LIST_TTL = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & { __ooviModelLists?: Map<string, { at: number; list: ModelInfo[] }> };
const listCache = (g.__ooviModelLists ??= new Map());

/** The provider's current models, as the API reports them. */
export async function listModels(p: ProviderId, s: Settings, fresh = false): Promise<ModelInfo[]> {
  const meta = PROVIDERS[p];
  const cfg = s.providers[p] ?? {};
  const base = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, "");
  const cacheKey = `${p}|${base}|${cfg.apiKey ? cfg.apiKey.slice(-6) : ""}`;
  const hit = listCache.get(cacheKey);
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit.list;
  if (!base) throw new Error("Set a server address first.");

  let models: ModelInfo[];
  if (p === "openrouter") {
    models = (await openRouterModels()).map((m) => ({
      id: m.id,
      name: m.name,
      context: m.context_length,
      price: orPrice(m),
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
      models = models.filter((m) => /gemini/.test(m.id) && !/embedding|tts|image|audio|live|aqa|robotics|computer-use|native/.test(m.id)).map((m) => ({ ...m, tools: true }));
      // Google's aliases that always point at the current models.
      for (const alias of ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"]) if (!models.some((m) => m.id === alias)) models.push({ id: alias, tools: true });
    }
    if (p === "openai") models = models.filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id) && !/audio|realtime|transcribe|tts|image|search|embedding/.test(m.id));
  }
  const prices = await priceTable().catch(() => null);
  for (const m of models) {
    if (!m.price && prices) m.price = lookupPrice(p, m.id, prices);
    if (meta.free && p !== "openrouter") m.free = true; // free tier (Gemini, Groq, Ollama)
  }
  models.sort((a, b) => Number(!!b.free) - Number(!!a.free) || Number(b.tools !== false) - Number(a.tools !== false) || a.id.localeCompare(b.id));
  listCache.set(cacheKey, { at: Date.now(), list: models });
  return models;
}

// ---------- prices (from OpenRouter's public list, cached for a day) ----------

const PRICE_TTL = 24 * 60 * 60 * 1000;
const priceFile = () => path.join(baseDir(), "model-prices.json");
let priceMem: { at: number; byId: Record<string, Price> } | null = null;

async function openRouterModels(): Promise<ORModel[]> {
  const j = (await fetchJson("https://openrouter.ai/api/v1/models", {})) as { data?: ORModel[] };
  return j.data ?? [];
}

function orPrice(m: ORModel): Price | undefined {
  const i = Number(m.pricing?.prompt);
  const o = Number(m.pricing?.completion);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return undefined; // "-1" = varies (openrouter/auto)
  return { input: +(i * 1e6).toFixed(4), output: +(o * 1e6).toFixed(4) };
}

async function priceTable(): Promise<Record<string, Price>> {
  if (priceMem && Date.now() - priceMem.at < PRICE_TTL) return priceMem.byId;
  try {
    const disk = JSON.parse(fs.readFileSync(priceFile(), "utf8")) as { at: number; byId: Record<string, Price> };
    if (Date.now() - disk.at < PRICE_TTL) return (priceMem = disk).byId;
  } catch {
    /* no cache yet */
  }
  const byId: Record<string, Price> = {};
  for (const m of await openRouterModels()) {
    const p = orPrice(m);
    if (p) byId[m.id] = p;
  }
  priceMem = { at: Date.now(), byId };
  try {
    fs.mkdirSync(path.dirname(priceFile()), { recursive: true });
    fs.writeFileSync(priceFile(), JSON.stringify(priceMem));
  } catch {
    /* not fatal */
  }
  return byId;
}

const VENDOR: Partial<Record<ProviderId, string>> = { anthropic: "anthropic", openai: "openai", xai: "x-ai", gemini: "google", deepseek: "deepseek", mistral: "mistralai" };
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/[-@](\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/-latest$/, "")
    .replace(/[._:\s]+/g, "-");

function lookupPrice(p: ProviderId, model: string, table: Record<string, Price>): Price | undefined {
  if (p === "openrouter") return table[model];
  const vendor = VENDOR[p];
  if (!vendor) return undefined;
  const want = norm(model);
  for (const [id, price] of Object.entries(table)) {
    const [v, slug] = id.split("/");
    if (v === vendor && slug && norm(slug.replace(/:.*$/, "")) === want) return price;
  }
  return undefined;
}

/** US dollars per 1M tokens for a model, if known. Free tiers count as free. */
export async function priceOf(p: ProviderId, model: string): Promise<Price | "free" | undefined> {
  if (p === "ollama" || (p === "openrouter" && /:free$/.test(model))) return "free";
  if (PROVIDERS[p].free && p !== "openrouter") return "free";
  try {
    return lookupPrice(p, model, await priceTable());
  } catch {
    return undefined;
  }
}

/** Cost in US dollars of one model call. */
export async function costOf(p: ProviderId, model: string, input: number, output: number): Promise<number | undefined> {
  const price = await priceOf(p, model);
  if (price === "free") return 0;
  if (!price) return undefined;
  return (input * price.input + output * price.output) / 1e6;
}

// ---------- retired models ----------

const tokens = (id: string) => norm(id).split("-").filter(Boolean);

/**
 * The closest current model to one the provider no longer serves, e.g.
 * gemini-2.5-flash -> gemini-flash-latest. Prefers "latest" aliases and the
 * same family (flash / pro / mini / sonnet …).
 */
export async function replacementFor(p: ProviderId, dead: string, s: Settings): Promise<string | null> {
  let list: ModelInfo[];
  try {
    list = await listModels(p, s, true);
  } catch {
    return null;
  }
  const want = new Set(tokens(dead).filter((t) => !/^\d/.test(t)));
  let best: { id: string; score: number } | null = null;
  for (const m of list) {
    if (m.id === dead || m.tools === false) continue;
    if (/preview|exp|thinking|tts|vision|guard|embed/.test(m.id) && !/preview|exp/.test(dead)) continue;
    const have = tokens(m.id);
    let score = have.filter((t) => want.has(t)).length * 10 - have.filter((t) => !/^\d/.test(t) && !want.has(t)).length * 3;
    if (/latest/.test(m.id)) score += 6;
    const ver = Number((m.id.match(/(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
    score += Math.min(ver, 20) / 10;
    if (!best || score > best.score) best = { id: m.id, score };
  }
  return best && best.score > 5 ? best.id : null;
}
