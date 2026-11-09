// theOovi: the hosted model behind the oovi account.
//
// The desktop app sends an Anthropic Messages-style request here with the user's
// session token. This route (server-side only):
//   - checks the account (blocked, paused for the user, credits, today's limit, concurrency)
//   - checks the global daily budget (a kill switch for runaway spend)
//   - keeps only the fields it expects, caps sizes, and picks the model itself
//   - calls the provider with the key from the console (never sent to anyone)
//   - charges what the call really cost and records it for the console's KPIs
import { clientIp, getRequestSession, json, rateLimit } from "@/lib/api";
import { EFFORTS, getAiConfig, getProviderKey, type AiConfig, type Effort } from "@/lib/ai-config";
import {
  bumpSpend,
  costUsd,
  dailyLimitFor,
  ensureAccount,
  isBlocked,
  mcToCredits,
  nextUtcMidnight,
  recordCall,
  reserve,
  settle,
  spendToday,
  usdToMc,
  type Usage,
} from "@/lib/credits";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY = 3 * 1024 * 1024;
const MAX_MESSAGES = 600;
const MAX_TOOLS = 128;
const UPSTREAM_TIMEOUT = 270_000;
// Server-side setting only (tests point it at a local mock). Never taken from a request.
const UPSTREAM = (process.env.OOVI_AI_UPSTREAM || "https://api.anthropic.com").replace(/\/+$/, "");
const BLOCK_TYPES = new Set(["text", "tool_use", "tool_result", "image"]);

type Block = Record<string, unknown>;
type Message = { role: "user" | "assistant"; content: string | Block[] };

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, code, ...extra }, status);
}

/** Rough token estimate: about 3 characters per token for Claude 5.x tokenizers. Same rule as the app. */
const estimateTokens = (chars: number) => Math.ceil(chars / 3);

function cleanCache(b: Block): Block {
  const out = { ...b };
  if ("cache_control" in out) {
    const cc = out.cache_control as { type?: unknown } | null;
    if (cc && typeof cc === "object" && cc.type === "ephemeral") out.cache_control = { type: "ephemeral" };
    else delete out.cache_control;
  }
  return out;
}

/** Keeps only valid roles and block types; null when the shape is wrong. */
function cleanMessages(raw: unknown): Message[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: Message[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content === "string") {
      out.push({ role, content });
      continue;
    }
    if (!Array.isArray(content)) return null;
    const blocks = content.filter((b): b is Block => !!b && typeof b === "object" && BLOCK_TYPES.has(String((b as Block).type))).map(cleanCache);
    if (!blocks.length) return null;
    out.push({ role, content: blocks });
  }
  return out[0]?.role === "user" ? out : null;
}

function cleanSystem(raw: unknown): string | Block[] | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return null;
  return raw.filter((b): b is Block => !!b && typeof b === "object" && (b as Block).type === "text" && typeof (b as Block).text === "string").map(cleanCache);
}

function cleanTools(raw: unknown): Block[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS) return null;
  const out: Block[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return null;
    const { name, description, input_schema, cache_control } = t as Block;
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(name)) return null;
    if (!input_schema || typeof input_schema !== "object") return null;
    out.push(cleanCache({ name, description: typeof description === "string" ? description : "", input_schema, ...(cache_control ? { cache_control } : {}) }));
  }
  return out;
}

function effortOf(raw: unknown, cfg: AiConfig): Effort | null {
  if (typeof raw !== "string" || !(EFFORTS as readonly string[]).includes(raw)) return null;
  return EFFORTS[Math.min(EFFORTS.indexOf(raw as Effort), EFFORTS.indexOf(cfg.maxEffort))]!;
}

type Upstream = { ok: boolean; status: number; body: Record<string, unknown> | null; text: string; retryAfter: number | null };

async function callAnthropic(key: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Upstream> {
  try {
    const res = await fetch(`${UPSTREAM}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const ra = Number(res.headers.get("retry-after"));
    return { ok: res.ok, status: res.status, body: parsed, text, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null };
  } catch (err) {
    const name = (err as Error).name;
    return { ok: false, status: name === "TimeoutError" || name === "AbortError" ? 504 : 0, body: null, text: (err as Error).message, retryAfter: null };
  }
}

const transient = (s: number) => s === 0 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529;

function upstreamMessage(u: Upstream): string {
  const e = (u.body?.error as { message?: unknown } | undefined)?.message;
  return typeof e === "string" ? e.slice(0, 500) : `HTTP ${u.status}`;
}

const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, creditsMc: 0 };

export async function POST(req: Request) {
  const started = Date.now();
  const session = await getRequestSession(req);
  if (!session) return fail(401, "signed_out", "You're signed out. Sign in to use theOovi.");
  const userId = session.user.id;
  if (await isBlocked(userId)) return fail(403, "blocked", "This account has been blocked. Contact contact@conuron.com.");
  if (!rateLimit(`ai:${userId}`, 120)) return fail(429, "busy", "Too many requests. Wait a moment.");

  const cfg = await getAiConfig();
  if (!cfg.enabled) return fail(503, "off", `${cfg.displayName} isn't available right now. Add your own API key in Settings > AI models.`);
  if (cfg.paused) return fail(503, "paused", cfg.pausedMessage);
  if (cfg.dailyBudgetUsd > 0 && (await spendToday()) >= cfg.dailyBudgetUsd) {
    return fail(503, "paused", `${cfg.displayName} has reached today's capacity and will be back at midnight UTC. Your own API keys still work.`);
  }
  const key = await getProviderKey();
  if (!key) {
    console.error("theOovi: no provider key configured");
    return fail(503, "off", `${cfg.displayName} isn't available right now. Please try again later.`);
  }

  // ---- read and clean the request ----
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "context_too_large", "This request is too large.");
  let raw: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return fail(413, "context_too_large", "This request is too large.");
    raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch {
    return fail(400, "bad_request", "Invalid request.");
  }
  const messages = cleanMessages(raw.messages);
  const system = cleanSystem(raw.system);
  const tools = cleanTools(raw.tools);
  if (!messages || system === null || tools === null) return fail(400, "bad_request", "Invalid request.");
  const requestedOut = typeof raw.max_tokens === "number" && raw.max_tokens > 0 ? Math.floor(raw.max_tokens) : 8192;
  const maxOut = Math.min(requestedOut, cfg.maxOutputTokens);
  const effort = effortOf(raw.effort, cfg);

  const estIn = estimateTokens(JSON.stringify(system).length + JSON.stringify(messages).length + JSON.stringify(tools).length);
  if (estIn > cfg.maxInputTokens) {
    return fail(413, "context_too_large", "This conversation is too long for one request. oovi will summarize older messages and try again.", {
      maxInputTokens: cfg.maxInputTokens,
    });
  }

  // ---- credits: hold the most this call could cost ----
  const account = await ensureAccount(userId, clientIp(req));
  const holdMc = usdToMc(costUsd({ input: estIn, output: maxOut, cacheRead: 0, cacheWrite: 0 }, cfg.prices), cfg);
  const held = await reserve(account, holdMc, cfg);
  if (!held.ok) {
    await recordCall(userId, { ...NO_USAGE, latencyMs: 0, blocked: true }).catch(() => {});
    return fail(held.status, held.code, held.message, { resetsAt: nextUtcMidnight() });
  }

  // ---- call the model (one retry, then the backup model if one is set) ----
  const body = (model: string, withEffort: boolean): Record<string, unknown> => ({
    model,
    max_tokens: maxOut,
    system,
    messages,
    ...(tools.length ? { tools } : {}),
    ...(effort && withEffort ? { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } } : {}),
  });
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT)]);
  const models = [cfg.model, ...(cfg.backupModel && cfg.backupModel !== cfg.model ? [cfg.backupModel] : [])];
  let up: Upstream | null = null;
  for (const model of models) {
    let withEffort = true;
    for (let attempt = 0; attempt < 3; attempt++) {
      up = await callAnthropic(key, body(model, withEffort), signal);
      if (up.ok || req.signal.aborted) break;
      // A setting this model doesn't accept: try again without thinking/effort.
      if (up.status === 400 && withEffort && effort && /thinking|effort|output_config/i.test(up.text)) {
        withEffort = false;
        continue;
      }
      if (!transient(up.status) || attempt >= 1) break;
      await new Promise((r) => setTimeout(r, Math.min(5, up?.retryAfter ?? 1.5) * 1000));
    }
    if (up?.ok || req.signal.aborted || !(transient(up?.status ?? 0) || up?.status === 404)) break;
  }

  if (!up || !up.ok) {
    await settle(userId, held.holdMc, 0).catch(() => {});
    await recordCall(userId, { ...NO_USAGE, latencyMs: Date.now() - started, error: true }).catch(() => {});
    if (req.signal.aborted) return fail(499, "cancelled", "Cancelled.");
    const s = up?.status ?? 0;
    if (s === 401 || s === 403) {
      console.error("theOovi: the provider rejected the API key");
      return fail(503, "unavailable", `${cfg.displayName} isn't available right now. Please try again later.`);
    }
    if (s === 400 || s === 413) return fail(400, "bad_request", upstreamMessage(up!));
    return fail(503, "busy", `${cfg.displayName} is very busy right now. Try again in a minute.`);
  }

  // ---- charge what it really cost ----
  const u = (up.body?.usage ?? {}) as Record<string, unknown>;
  const usage: Usage = {
    input: Number(u.input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    cacheRead: Number(u.cache_read_input_tokens ?? 0),
    cacheWrite: Number(u.cache_creation_input_tokens ?? 0),
  };
  const usd = costUsd(usage, cfg.prices);
  const usedMc = usdToMc(usd, cfg);
  const after = await settle(userId, held.holdMc, usedMc);
  bumpSpend(usd);
  await recordCall(userId, { ...usage, costUsd: usd, creditsMc: usedMc, latencyMs: Date.now() - started }).catch((err) =>
    console.error("usage record failed", err instanceof Error ? err.message : err),
  );

  return json({
    ...up.body,
    // White label: the app shows theOovi, never the provider's model name.
    model: cfg.displayName,
    oovi: {
      credits: Math.round(mcToCredits(usedMc) * 100) / 100,
      balance: Math.max(0, Math.floor(mcToCredits(after.balanceMc) * 10) / 10),
      dailyUsed: Math.ceil(mcToCredits(after.dayUsedMc) * 10) / 10,
      dailyLimit: await dailyLimitFor(account),
      resetsAt: nextUtcMidnight(),
    },
  });
}
