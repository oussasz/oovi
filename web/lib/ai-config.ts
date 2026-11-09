// theOovi settings, edited in the admin console (/admin/ai) and stored in app_config.
// Every value has a safe default, so the hosted model works before anything is saved.
// The provider API key is stored encrypted (AES-256-GCM) and is never sent to a browser
// or to the desktop app: only the AI proxy reads it, on the server.
import crypto from "node:crypto";
import { pool } from "./db";

export const EFFORTS = ["low", "medium", "high", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Prices in US dollars per million tokens. */
export type Prices = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Prompts above this many tokens are billed at the long-context rates. */
  longAbove: number;
  longInput: number;
  longOutput: number;
};

export type Plan = {
  id: string;
  name: string;
  /** Shown on the pricing page, e.g. "$9.99 / month". Empty = not for sale. */
  price: string;
  /** Added at the start of every month the plan is active. */
  monthlyCredits: number;
  /** Credits per day (resets 00:00 UTC). */
  dailyLimit: number;
  /** Listed on the public pricing page. */
  visible: boolean;
};

export type AiConfig = {
  /** Master switch for the hosted model. Off = only users' own API keys work. */
  enabled: boolean;
  /** Temporarily stop all hosted calls (emergencies). */
  paused: boolean;
  pausedMessage: string;
  /** The white-label name users see. */
  displayName: string;
  /** Provider model ID behind the white label (Anthropic). */
  model: string;
  /** Optional second model, used only when the first one is down or overloaded. */
  backupModel: string;
  prices: Prices;
  /** 1 credit = 1 / creditsPerUsd US dollars of model cost. */
  creditsPerUsd: number;
  /** Requests above this size are refused; the app compacts history to stay below it. */
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEffort: Effort;
  /** Calls one person can run at the same time. */
  maxConcurrent: number;
  /** All users together; hosted calls pause for the rest of the UTC day once reached. 0 = no cap. */
  dailyBudgetUsd: number;
  /** Given once to every new account. */
  signupCredits: number;
  /** At most this many signup grants per network per 30 days (stops mass sign-ups). 0 = no cap. */
  signupGrantsPerNetwork: number;
  /** Where "Subscribe" sends people. Empty = the website's pricing page. */
  subscribeUrl: string;
};

export type PilotConfig = {
  enabled: boolean;
  /** Shown in the app, on the pricing page and on the account page. Off = only people with the link find it. */
  public: boolean;
  /** ISO dates. Accounts created inside this window can apply. */
  startsAt: string;
  endsAt: string;
  credits: number;
  /** Plan given on approval (its daily limit applies). */
  plan: string;
  /** Plan length in days after approval. */
  days: number;
};

export const DEFAULT_PLANS: Plan[] = [
  // Daily limits are a safety cap against runaway use, not a quota people should feel.
  { id: "free", name: "Free", price: "", monthlyCredits: 0, dailyLimit: 1000, visible: true },
  { id: "plus", name: "Plus", price: "$9.99 / month", monthlyCredits: 5000, dailyLimit: 2000, visible: true },
  { id: "pro", name: "Pro", price: "$24.99 / month", monthlyCredits: 12000, dailyLimit: 5000, visible: true },
  { id: "pilot", name: "Pilot", price: "", monthlyCredits: 0, dailyLimit: 5000, visible: false },
];

export const DEFAULT_AI: AiConfig = {
  enabled: true,
  paused: false,
  pausedMessage: "theOovi is paused for maintenance. It will be back shortly. Your own API keys still work.",
  displayName: "theOovi 1.1",
  model: "claude-haiku-5-5",
  backupModel: "",
  // Claude Haiku 5.5 list prices (cache reads 0.1x input, 5-minute cache writes 1.25x).
  prices: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longAbove: 100_000, longInput: 0.5, longOutput: 2.5 },
  creditsPerUsd: 1000,
  maxInputTokens: 100_000,
  maxOutputTokens: 16_000,
  maxEffort: "high",
  maxConcurrent: 3,
  dailyBudgetUsd: 25,
  signupCredits: 1000,
  signupGrantsPerNetwork: 3,
  subscribeUrl: "",
};

export const DEFAULT_PILOT: PilotConfig = {
  enabled: true,
  public: false,
  startsAt: "2026-11-09",
  endsAt: "2027-01-31",
  credits: 10_000,
  plan: "pilot",
  days: 60,
};

// ---------- reading and saving ----------

type Cached = { ai: AiConfig; plans: Plan[]; pilot: PilotConfig; at: number };
const g = globalThis as typeof globalThis & { __ooviAiConfig?: Cached };
const TTL = 15_000;

const num = (v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const str = (v: unknown, d: string, max = 500) => (typeof v === "string" ? v.slice(0, max) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function normalizeAi(raw: unknown): AiConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (r.prices && typeof r.prices === "object" ? r.prices : {}) as Record<string, unknown>;
  const d = DEFAULT_AI;
  return {
    enabled: bool(r.enabled, d.enabled),
    paused: bool(r.paused, d.paused),
    pausedMessage: str(r.pausedMessage, d.pausedMessage) || d.pausedMessage,
    displayName: str(r.displayName, d.displayName, 40).trim() || d.displayName,
    model: str(r.model, d.model, 100).trim() || d.model,
    backupModel: str(r.backupModel, d.backupModel, 100).trim(),
    prices: {
      input: num(p.input, d.prices.input, 0, 1000),
      output: num(p.output, d.prices.output, 0, 1000),
      cacheRead: num(p.cacheRead, d.prices.cacheRead, 0, 1000),
      cacheWrite: num(p.cacheWrite, d.prices.cacheWrite, 0, 1000),
      longAbove: num(p.longAbove, d.prices.longAbove, 0, 10_000_000),
      longInput: num(p.longInput, d.prices.longInput, 0, 1000),
      longOutput: num(p.longOutput, d.prices.longOutput, 0, 1000),
    },
    creditsPerUsd: num(r.creditsPerUsd, d.creditsPerUsd, 1, 1_000_000),
    maxInputTokens: num(r.maxInputTokens, d.maxInputTokens, 4_000, 1_000_000),
    maxOutputTokens: num(r.maxOutputTokens, d.maxOutputTokens, 256, 128_000),
    maxEffort: (EFFORTS as readonly string[]).includes(r.maxEffort as string) ? (r.maxEffort as Effort) : d.maxEffort,
    maxConcurrent: num(r.maxConcurrent, d.maxConcurrent, 1, 50),
    dailyBudgetUsd: num(r.dailyBudgetUsd, d.dailyBudgetUsd, 0, 1_000_000),
    signupCredits: num(r.signupCredits, d.signupCredits, 0, 10_000_000),
    signupGrantsPerNetwork: num(r.signupGrantsPerNetwork, d.signupGrantsPerNetwork, 0, 10_000),
    subscribeUrl: /^https:\/\//.test(str(r.subscribeUrl, "")) ? str(r.subscribeUrl, "") : "",
  };
}

const PLAN_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function normalizePlans(raw: unknown): Plan[] {
  if (!Array.isArray(raw)) return DEFAULT_PLANS;
  const out: Plan[] = [];
  for (const x of raw.slice(0, 20)) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = str(r.id, "", 32);
    if (!PLAN_ID.test(id) || out.some((p) => p.id === id)) continue;
    out.push({
      id,
      name: str(r.name, id, 40) || id,
      price: str(r.price, "", 40),
      monthlyCredits: Math.round(num(r.monthlyCredits, 0, 0, 100_000_000)),
      dailyLimit: Math.round(num(r.dailyLimit, 0, 0, 100_000_000)),
      visible: bool(r.visible, false),
    });
  }
  // "free" must always exist: it's what everyone falls back to.
  if (!out.some((p) => p.id === "free")) out.unshift(DEFAULT_PLANS[0]!);
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizePilot(raw: unknown): PilotConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PILOT;
  return {
    enabled: bool(r.enabled, d.enabled),
    public: bool(r.public, d.public),
    startsAt: DATE.test(str(r.startsAt, "", 10)) ? str(r.startsAt, "", 10) : d.startsAt,
    endsAt: DATE.test(str(r.endsAt, "", 10)) ? str(r.endsAt, "", 10) : d.endsAt,
    credits: Math.round(num(r.credits, d.credits, 0, 10_000_000)),
    plan: PLAN_ID.test(str(r.plan, "", 32)) ? str(r.plan, "", 32) : d.plan,
    days: Math.round(num(r.days, d.days, 1, 3650)),
  };
}

async function load(): Promise<Cached> {
  const now = Date.now();
  const c = g.__ooviAiConfig;
  if (c && now - c.at < TTL) return c;
  let rows: { key: string; value: unknown }[] = [];
  try {
    rows = (await pool.query("SELECT key, value FROM app_config WHERE key IN ('ai', 'plans', 'pilot')")).rows;
  } catch (err) {
    // Table missing (migration not run yet) or a database hiccup: keep the last good values.
    if (c) return c;
    console.error("app_config read failed", err instanceof Error ? err.message : err);
  }
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const next = { ai: normalizeAi(get("ai")), plans: normalizePlans(get("plans")), pilot: normalizePilot(get("pilot")), at: now };
  g.__ooviAiConfig = next;
  return next;
}

export const getAiConfig = async () => (await load()).ai;
export const getPlans = async () => (await load()).plans;
export const getPilotConfig = async () => (await load()).pilot;

export async function planById(id: string): Promise<Plan> {
  const plans = await getPlans();
  return plans.find((p) => p.id === id) ?? plans.find((p) => p.id === "free") ?? DEFAULT_PLANS[0]!;
}

/** Is the pilot open today, and was this account created inside its window? */
export function pilotOpenFor(p: PilotConfig, userCreatedAt: Date | string, now = new Date()): { open: boolean; eligible: boolean } {
  const start = new Date(`${p.startsAt}T00:00:00Z`).getTime();
  const end = new Date(`${p.endsAt}T23:59:59Z`).getTime();
  const t = now.getTime();
  const open = p.enabled && t >= start && t <= end;
  const created = new Date(userCreatedAt).getTime();
  return { open, eligible: open && created >= start && created <= end };
}

async function save(key: string, value: unknown, by: string) {
  await pool.query(
    `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), by],
  );
  g.__ooviAiConfig = undefined;
}

export const saveAiConfig = (v: unknown, by: string) => save("ai", normalizeAi(v), by);
export const savePlans = (v: unknown, by: string) => save("plans", normalizePlans(v), by);
export const savePilotConfig = (v: unknown, by: string) => save("pilot", normalizePilot(v), by);

// ---------- the provider API key (encrypted at rest) ----------

type Sealed = { iv: string; tag: string; data: string };

function boxKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("AI_KEY_SECRET (or BETTER_AUTH_SECRET) is not set.");
  return crypto.createHash("sha256").update(`oovi-ai-key:${secret}`).digest();
}

function seal(text: string): Sealed {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", boxKey(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function unseal(v: Sealed): string {
  const d = crypto.createDecipheriv("aes-256-gcm", boxKey(), Buffer.from(v.iv, "base64"));
  d.setAuthTag(Buffer.from(v.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(v.data, "base64")), d.final()]).toString("utf8");
}

type KeyCache = { key: string | null; at: number };
const kg = globalThis as typeof globalThis & { __ooviAiKey?: KeyCache };

/** The Anthropic key: the one saved in the console, else ANTHROPIC_API_KEY. Server-only. */
export async function getProviderKey(): Promise<string | null> {
  const now = Date.now();
  const c = kg.__ooviAiKey;
  if (c && now - c.at < TTL) return c.key;
  let key: string | null = null;
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'ai_secret'");
    const v = rows[0]?.value as Sealed | undefined;
    if (v?.data) key = unseal(v);
  } catch (err) {
    console.error("AI key read failed", err instanceof Error ? err.message : "unknown error");
  }
  key ||= process.env.ANTHROPIC_API_KEY || null;
  kg.__ooviAiKey = { key, at: now };
  return key;
}

/** What the console may show about the key: where it comes from and its last 4 characters. */
export async function providerKeyInfo(): Promise<{ source: "console" | "env" | "none"; hint: string | null; updatedAt: string | null }> {
  let rows: { value: unknown; updated_at: Date }[] = [];
  try {
    rows = (await pool.query("SELECT value, updated_at FROM app_config WHERE key = 'ai_secret'")).rows;
  } catch {
    rows = [];
  }
  const v = rows[0]?.value as Sealed | undefined;
  if (v?.data) {
    try {
      const k = unseal(v);
      return { source: "console", hint: `…${k.slice(-4)}`, updatedAt: new Date(rows[0]!.updated_at).toISOString() };
    } catch {
      return { source: "none", hint: null, updatedAt: null };
    }
  }
  const env = process.env.ANTHROPIC_API_KEY;
  return env ? { source: "env", hint: `…${env.slice(-4)}`, updatedAt: null } : { source: "none", hint: null, updatedAt: null };
}

export async function saveProviderKey(key: string | null, by: string): Promise<void> {
  if (key === null) await pool.query("DELETE FROM app_config WHERE key = 'ai_secret'");
  else await save("ai_secret", seal(key), by);
  kg.__ooviAiKey = undefined;
}
