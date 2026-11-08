import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PROVIDERS, type ProviderId } from "./providers-meta";

export type ProviderConfig = { apiKey?: string; baseUrl?: string; model?: string };
export type BrowserConfig = {
  mode: "local" | "docker";
  channel: "auto" | "msedge" | "chrome" | "chromium";
  wsEndpoint: string;
  allowPrivateNetwork: boolean;
};
export type SearchProvider = "none" | "searxng" | "brave" | "tavily";
export type SearchConfig = { provider: SearchProvider; searxngUrl: string; braveKey?: string; tavilyKey?: string };
/** One model on one provider. */
export type ModelRef = { provider: ProviderId; model: string };
export type Settings = {
  active: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Backup models, tried in order when a bot's own model fails or is rate-limited. */
  fallbacks: ModelRef[];
  search: SearchConfig;
  browser: BrowserConfig;
  approvals: { clicksAndTyping: boolean };
  maxSteps: number;
  /** In groups: how many bot-to-bot hand-offs one user message may trigger. */
  maxTurns: number;
};

export type PublicProvider = { baseUrl?: string; model?: string; hasKey: boolean; keyHint?: string };
export type PublicSearch = { provider: SearchProvider; searxngUrl: string; hasBraveKey: boolean; hasTavilyKey: boolean };
export type PublicSettings = Omit<Settings, "providers" | "search"> & { providers: Partial<Record<ProviderId, PublicProvider>>; search: PublicSearch };

export type SettingsPatch = {
  active?: ProviderId;
  providers?: Partial<Record<ProviderId, { apiKey?: string; clearKey?: boolean; baseUrl?: string; model?: string }>>;
  search?: { provider?: SearchProvider; searxngUrl?: string; braveKey?: string; tavilyKey?: string; clearBraveKey?: boolean; clearTavilyKey?: boolean };
  browser?: Partial<BrowserConfig>;
  approvals?: Partial<Settings["approvals"]>;
  maxSteps?: number;
  maxTurns?: number;
  fallbacks?: ModelRef[];
};

const DEFAULTS: Settings = {
  active: "anthropic",
  providers: {},
  fallbacks: [],
  search: { provider: "none", searxngUrl: "http://127.0.0.1:8888" },
  browser: {
    mode: "local",
    channel: "auto",
    wsEndpoint: "ws://127.0.0.1:3200/",
    allowPrivateNetwork: false,
  },
  approvals: { clicksAndTyping: true },
  maxSteps: 25,
  maxTurns: 6,
};

export const dataDir = () => process.env.OOVI_DATA || path.join(process.cwd(), "data");
const settingsFile = () => path.join(dataDir(), "settings.json");

// ---- encryption at rest (AES-256-GCM) ----

function secretKey(): Buffer {
  if (process.env.OOVI_SECRET) return crypto.createHash("sha256").update(process.env.OOVI_SECRET).digest();
  fs.mkdirSync(dataDir(), { recursive: true });
  const p = path.join(dataDir(), ".secret");
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(p, "utf8").trim(), "hex");
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

function decrypt(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad key format");
  const d = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// ---- storage ----

/** Settings as stored on disk (API keys still encrypted). */
function readRaw(): Settings {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULTS),
      ...j,
      providers: j.providers ?? {},
      search: { ...DEFAULTS.search, ...j.search },
      browser: { ...DEFAULTS.browser, ...j.browser },
      approvals: { ...DEFAULTS.approvals, ...j.approvals },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function writeRaw(s: Settings) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Encrypt / decrypt other secrets (MCP tokens) with the same local key. */
export const encryptSecret = (plain: string) => encrypt(plain);
export const decryptSecret = (stored: string) => decrypt(stored);

/** Server-only: settings with decrypted API keys. Never send this to the browser. */
export function loadSettings(): Settings {
  const s = readRaw();
  for (const p of Object.values(s.providers)) {
    if (p?.apiKey) {
      try {
        p.apiKey = decrypt(p.apiKey);
      } catch {
        p.apiKey = undefined; // secret changed or file edited: key must be re-entered
      }
    }
  }
  for (const k of ["braveKey", "tavilyKey"] as const) {
    const v = s.search[k];
    if (v) {
      try {
        s.search[k] = decrypt(v);
      } catch {
        s.search[k] = undefined;
      }
    }
  }
  return s;
}

/** Safe to send to the UI: keys replaced by a hint. */
export function publicSettings(): PublicSettings {
  const s = loadSettings();
  const providers: PublicSettings["providers"] = {};
  for (const [id, p] of Object.entries(s.providers) as [ProviderId, ProviderConfig | undefined][]) {
    if (!p) continue;
    providers[id] = { baseUrl: p.baseUrl, model: p.model, hasKey: !!p.apiKey, keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : undefined };
  }
  const search: PublicSearch = { provider: s.search.provider, searxngUrl: s.search.searxngUrl, hasBraveKey: !!s.search.braveKey, hasTavilyKey: !!s.search.tavilyKey };
  return { ...s, providers, search };
}

export function updateSettings(patch: SettingsPatch): void {
  const raw = readRaw();
  if (patch.active && patch.active in PROVIDERS) raw.active = patch.active;

  for (const [id, p] of Object.entries(patch.providers ?? {}) as [ProviderId, NonNullable<SettingsPatch["providers"]>[ProviderId]][]) {
    if (!(id in PROVIDERS) || !p) continue;
    const cur: ProviderConfig = raw.providers[id] ?? {};
    if (p.clearKey) delete cur.apiKey;
    else if (typeof p.apiKey === "string" && p.apiKey.trim()) cur.apiKey = encrypt(p.apiKey.trim());
    if (typeof p.baseUrl === "string") cur.baseUrl = p.baseUrl.trim() || undefined;
    if (typeof p.model === "string") cur.model = p.model.trim() || undefined;
    raw.providers[id] = cur;
  }

  const q = patch.search;
  if (q) {
    if (q.provider === "none" || q.provider === "searxng" || q.provider === "brave" || q.provider === "tavily") raw.search.provider = q.provider;
    if (typeof q.searxngUrl === "string" && /^https?:\/\/\S+$/.test(q.searxngUrl.trim())) raw.search.searxngUrl = q.searxngUrl.trim().replace(/\/+$/, "");
    if (q.clearBraveKey) delete raw.search.braveKey;
    else if (typeof q.braveKey === "string" && q.braveKey.trim()) raw.search.braveKey = encrypt(q.braveKey.trim());
    if (q.clearTavilyKey) delete raw.search.tavilyKey;
    else if (typeof q.tavilyKey === "string" && q.tavilyKey.trim()) raw.search.tavilyKey = encrypt(q.tavilyKey.trim());
  }

  const b = patch.browser;
  if (b) {
    if (b.mode === "local" || b.mode === "docker") raw.browser.mode = b.mode;
    if (b.channel === "auto" || b.channel === "msedge" || b.channel === "chrome" || b.channel === "chromium") raw.browser.channel = b.channel;
    if (typeof b.wsEndpoint === "string" && /^wss?:\/\/\S+$/.test(b.wsEndpoint.trim())) raw.browser.wsEndpoint = b.wsEndpoint.trim();
    if (typeof b.allowPrivateNetwork === "boolean") raw.browser.allowPrivateNetwork = b.allowPrivateNetwork;
  }
  if (typeof patch.approvals?.clicksAndTyping === "boolean") raw.approvals.clicksAndTyping = patch.approvals.clicksAndTyping;
  if (typeof patch.maxSteps === "number" && Number.isFinite(patch.maxSteps)) raw.maxSteps = Math.min(100, Math.max(1, Math.round(patch.maxSteps)));
  if (typeof patch.maxTurns === "number" && Number.isFinite(patch.maxTurns)) raw.maxTurns = Math.min(30, Math.max(0, Math.round(patch.maxTurns)));
  if (Array.isArray(patch.fallbacks)) {
    raw.fallbacks = patch.fallbacks
      .filter((f) => f && typeof f.provider === "string" && f.provider in PROVIDERS && typeof f.model === "string" && f.model.trim())
      .slice(0, 12)
      .map((f) => ({ provider: f.provider, model: f.model.trim().slice(0, 160) }));
  }

  writeRaw(raw);
}
