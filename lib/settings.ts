import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { accountDir, baseDir, currentSession } from "./account";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "./providers-meta";

/** model: this provider's default model. models: the models the user switched on (bots pick from these). */
export type ProviderConfig = { apiKey?: string; baseUrl?: string; model?: string; models?: string[] };
export type BrowserConfig = {
  mode: "local" | "docker";
  channel: "auto" | "msedge" | "chrome" | "chromium";
  wsEndpoint: string;
  allowPrivateNetwork: boolean;
};
/** auto = the AI provider's own built-in web search (Claude or Gemini), no extra setup. */
export type SearchProvider = "auto" | "none" | "searxng" | "brave" | "tavily";
export type SearchConfig = { provider: SearchProvider; searxngUrl: string; braveKey?: string; tavilyKey?: string };
/**
 * Files on this computer (lib/computer.ts): off; ask before every read or send (default);
 * or read and send from the listed folders without asking (everything else still asks).
 */
export type ComputerFilesMode = "off" | "ask" | "folders";
export type ComputerFiles = { mode: ComputerFilesMode; folders: string[] };
/**
 * Desktop control (Beta, lib/desktop-control.ts): bots see the screen and use the mouse and
 * keyboard. Off by default; turning it on needs the user's consent (consentAt). askEvery: every
 * action that isn't just looking asks first (default on); the first action of a task always asks.
 */
export type DesktopControl = { enabled: boolean; consentAt?: number; askEvery: boolean };
/** One model on one provider. */
export type ModelRef = { provider: ProviderId; model: string };
export type Settings = {
  active: ProviderId;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Backup models, tried in order when a bot's own model fails or is rate-limited. */
  fallbacks: ModelRef[];
  search: SearchConfig;
  browser: BrowserConfig;
  /** auto: Auto mode, bots don't stop to ask (except for what AUTO_STILL_ASKS lists in lib/orchestrator.ts). */
  approvals: { clicksAndTyping: boolean; auto?: boolean };
  computerFiles: ComputerFiles;
  desktopControl: DesktopControl;
  maxSteps: number;
  /** In groups: how many bot-to-bot hand-offs one user message may trigger. */
  maxTurns: number;
  /** UI language: "auto" follows the system language. */
  language: string;
  /** Send anonymous crash reports (app version, OS, error) to oovi. */
  crashReports: boolean;
  /** Self-learning: review finished work and keep lessons (one small extra model call). */
  learning: boolean;
  /** Send daily usage counts (no content) so oovi can see what's used. */
  usageStats: boolean;
  /** Where bots save the files they make when a chat has no project folder (default: Downloads/oovi). */
  saveFolder?: string;
  /** Cloud computer for the bots (E2B virtual machines, the user's own key). */
  sandbox?: { e2bKey?: string };
  /** Models a provider retired, and what replaced them: {"gemini:gemini-2.5-flash": "gemini-flash-latest"}. */
  retired?: Record<string, string>;
};

export type PublicProvider = { baseUrl?: string; model?: string; models?: string[]; hasKey: boolean; keyHint?: string };
export type PublicSearch = { provider: SearchProvider; searxngUrl: string; hasBraveKey: boolean; hasTavilyKey: boolean };
/** hosted: bots run on theOovi (signed in, and theOovi is the main model or no own key is set up). */
export type PublicSettings = Omit<Settings, "providers" | "search" | "sandbox"> & {
  providers: Partial<Record<ProviderId, PublicProvider>>;
  search: PublicSearch;
  sandbox: { hasKey: boolean; keyHint?: string };
  hosted: boolean;
  ownModels: boolean;
};

export type SettingsPatch = {
  active?: ProviderId;
  providers?: Partial<Record<ProviderId, { apiKey?: string; clearKey?: boolean; baseUrl?: string; model?: string; models?: string[] }>>;
  search?: { provider?: SearchProvider; searxngUrl?: string; braveKey?: string; tavilyKey?: string; clearBraveKey?: boolean; clearTavilyKey?: boolean };
  browser?: Partial<BrowserConfig>;
  approvals?: Partial<Settings["approvals"]>;
  maxSteps?: number;
  maxTurns?: number;
  fallbacks?: ModelRef[];
  language?: string;
  crashReports?: boolean;
  learning?: boolean;
  usageStats?: boolean;
  sandbox?: { e2bKey?: string; clearKey?: boolean };
};

const DEFAULTS: Settings = {
  active: "anthropic",
  providers: {},
  fallbacks: [],
  search: { provider: "auto", searxngUrl: "http://127.0.0.1:8888" },
  browser: {
    mode: "local",
    channel: "auto",
    wsEndpoint: "ws://127.0.0.1:3200/",
    allowPrivateNetwork: false,
  },
  approvals: { clicksAndTyping: true },
  computerFiles: { mode: "ask", folders: [] },
  desktopControl: { enabled: false, askEvery: true },
  maxSteps: 25,
  maxTurns: 6,
  language: "auto",
  crashReports: true,
  learning: true,
  usageStats: true,
};

/** The signed-in account's data folder (falls back to a guest folder when signed out). */
export const dataDir = () => accountDir() ?? path.join(baseDir(), "guest");
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
      // "none" (search off) was removed: a bot with Web search always searches. Old settings become "auto".
      search: ((q) => (q.provider === "none" ? { ...q, provider: "auto" } : q))({ ...DEFAULTS.search, ...j.search }),
      browser: { ...DEFAULTS.browser, ...j.browser },
      approvals: { ...DEFAULTS.approvals, ...j.approvals },
      computerFiles: cleanComputerFiles(j.computerFiles),
      desktopControl: cleanDesktopControl(j.desktopControl),
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function cleanComputerFiles(v: unknown): ComputerFiles {
  const o = (v && typeof v === "object" ? v : {}) as Partial<ComputerFiles>;
  const mode: ComputerFilesMode = o.mode === "off" || o.mode === "folders" ? o.mode : "ask";
  const folders = Array.isArray(o.folders) ? [...new Set(o.folders.filter((f): f is string => typeof f === "string" && !!f.trim()))].slice(0, 50) : [];
  return { mode, folders };
}

function cleanDesktopControl(v: unknown): DesktopControl {
  const o = (v && typeof v === "object" ? v : {}) as Partial<DesktopControl>;
  const consentAt = typeof o.consentAt === "number" && Number.isFinite(o.consentAt) && o.consentAt > 0 ? o.consentAt : undefined;
  // Never on without the user's recorded consent.
  return { enabled: o.enabled === true && !!consentAt, askEvery: o.askEvery !== false, ...(consentAt ? { consentAt } : {}) };
}

/** Save the "Control this computer" setting (checked by app/api/desktop-control). */
export function setDesktopControl(next: DesktopControl): void {
  const raw = readRaw();
  raw.desktopControl = cleanDesktopControl(next);
  writeRaw(raw);
}

/** The folder the user chose for the files bots make (Settings > Files on this computer), if it still exists. */
export function chosenSaveFolder(): string | undefined {
  const p = readRaw().saveFolder;
  if (typeof p !== "string" || !p) return undefined;
  try {
    return fs.statSync(p).isDirectory() ? p : undefined;
  } catch {
    return undefined;
  }
}

/** Save the folder for the files bots make (already checked by the caller), or null for the default. */
export function setSaveFolder(p: string | null): void {
  const raw = readRaw();
  if (p) raw.saveFolder = p;
  else delete raw.saveFolder;
  writeRaw(raw);
}

/** Save the "Files on this computer" setting. Folders must already be checked (lib/computer.ts). */
export function setComputerFiles(next: ComputerFiles): void {
  const raw = readRaw();
  raw.computerFiles = cleanComputerFiles(next);
  writeRaw(raw);
}

function writeRaw(s: Settings) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** A provider stopped serving `dead`: remember the replacement and switch every setting over to it. */
export function markRetired(provider: ProviderId, dead: string, replacement: string): void {
  const raw = readRaw();
  raw.retired = { ...raw.retired, [`${provider}:${dead}`]: replacement };
  const cur = raw.providers[provider];
  if (cur) {
    if (cur.model === dead) cur.model = replacement;
    if (cur.models) cur.models = [...new Set(cur.models.map((m) => (m === dead ? replacement : m)))];
  }
  raw.fallbacks = raw.fallbacks.map((f) => (f.provider === provider && f.model === dead ? { ...f, model: replacement } : f));
  writeRaw(raw);
}

/** Follows the retired-model map (a -> b -> c). */
export function currentModel(s: Settings, provider: ProviderId, model: string): string {
  let m = model;
  for (let i = 0; i < 5 && s.retired?.[`${provider}:${m}`]; i++) m = s.retired[`${provider}:${m}`]!;
  return m;
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
  if (s.sandbox?.e2bKey) {
    try {
      s.sandbox.e2bKey = decrypt(s.sandbox.e2bKey);
    } catch {
      s.sandbox.e2bKey = undefined;
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

/** The person set up at least one model with their own key (or their own server). */
export function ownProviderConnected(s: Settings): boolean {
  return PROVIDER_IDS.some((p) => {
    const cfg = s.providers[p];
    if (!cfg) return false;
    return PROVIDERS[p].needsKey ? !!cfg.apiKey : !!(cfg.models?.length || cfg.model || cfg.baseUrl);
  });
}

/**
 * Bots run on theOovi (the hosted model, paid with credits) when the person is signed
 * in and either chose it as the main model or hasn't set up a model of their own.
 * Picking specific models is only for people who bring their own API key.
 */
export function usesHosted(s: Settings): boolean {
  return !!currentSession() && (s.active === "oovi" || !ownProviderConnected(s));
}

/** Safe to send to the UI: keys replaced by a hint. */
export function publicSettings(): PublicSettings {
  const s = loadSettings();
  const providers: PublicSettings["providers"] = {};
  for (const [id, p] of Object.entries(s.providers) as [ProviderId, ProviderConfig | undefined][]) {
    if (!p) continue;
    providers[id] = { baseUrl: p.baseUrl, model: p.model, models: p.models, hasKey: !!p.apiKey, keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : undefined };
  }
  const search: PublicSearch = { provider: s.search.provider, searxngUrl: s.search.searxngUrl, hasBraveKey: !!s.search.braveKey, hasTavilyKey: !!s.search.tavilyKey };
  const key = s.sandbox?.e2bKey;
  return { ...s, providers, search, sandbox: { hasKey: !!key, keyHint: key ? `…${key.slice(-4)}` : undefined }, hosted: usesHosted(s), ownModels: ownProviderConnected(s) };
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
    if (Array.isArray(p.models)) {
      cur.models = [...new Set(p.models.filter((m): m is string => typeof m === "string" && !!m.trim()).map((m) => m.trim().slice(0, 160)))].slice(0, 40);
    }
    // The default model is always one of the switched-on models.
    if (cur.model && !(cur.models ?? []).includes(cur.model)) cur.models = [cur.model, ...(cur.models ?? [])];
    if (p.clearKey && PROVIDERS[id].needsKey) delete cur.models;
    raw.providers[id] = cur;
  }

  const q = patch.search;
  if (q) {
    if (q.provider === "auto" || q.provider === "searxng" || q.provider === "brave" || q.provider === "tavily") raw.search.provider = q.provider;
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
  if (typeof patch.approvals?.auto === "boolean") raw.approvals.auto = patch.approvals.auto;
  if (typeof patch.maxSteps === "number" && Number.isFinite(patch.maxSteps)) raw.maxSteps = Math.min(100, Math.max(1, Math.round(patch.maxSteps)));
  if (typeof patch.maxTurns === "number" && Number.isFinite(patch.maxTurns)) raw.maxTurns = Math.min(30, Math.max(0, Math.round(patch.maxTurns)));
  if (typeof patch.language === "string" && /^(auto|[a-z]{2}(-[A-Z]{2})?)$/.test(patch.language)) raw.language = patch.language;
  if (typeof patch.crashReports === "boolean") raw.crashReports = patch.crashReports;
  if (typeof patch.learning === "boolean") raw.learning = patch.learning;
  if (typeof patch.usageStats === "boolean") raw.usageStats = patch.usageStats;
  if (patch.sandbox?.clearKey) delete raw.sandbox;
  else if (typeof patch.sandbox?.e2bKey === "string" && patch.sandbox.e2bKey.trim()) raw.sandbox = { e2bKey: encrypt(patch.sandbox.e2bKey.trim()) };
  if (Array.isArray(patch.fallbacks)) {
    raw.fallbacks = patch.fallbacks
      .filter((f) => f && typeof f.provider === "string" && f.provider in PROVIDERS && typeof f.model === "string" && f.model.trim())
      .slice(0, 12)
      .map((f) => ({ provider: f.provider, model: f.model.trim().slice(0, 160) }));
  }

  writeRaw(raw);
}
