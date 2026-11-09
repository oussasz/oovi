// Talks to model providers with plain fetch and the user's own keys.
// Two wire formats: Anthropic Messages, and OpenAI-compatible chat completions
// (OpenAI, xAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, Ollama, …).
//
// Reliability: every call goes through a model chain (the bot's model first,
// then the backups from Settings). If a model is rate-limited, down, missing,
// can't use tools, or times out, the next one answers instead, and the failing
// one "cools down" for a while so later calls skip straight past it.

import { appVersion, cloudUrl, sessionToken } from "./account";
import { noteHosted, noteHostedState, type HostedLive, type HostedState } from "./hosted";
import { costOf, readableError, replacementFor } from "./models";
import { HOSTED_NAME, PROVIDERS, providerName, type ProviderId } from "./providers-meta";
import { currentModel, markRetired, usesHosted, type ModelRef, type Settings } from "./settings";
import { replaceBotModel } from "./store";
import type { Msg, ToolCall } from "./types";

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
type RawCompletion = {
  text: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number };
  reasoning?: string;
  /** theOovi only: credits this call used, and the name to show for the model. */
  credits?: number;
  hostedName?: string;
};

/** How hard the model thinks. "auto" = the model's own default. */
export type Effort = "auto" | "low" | "medium" | "high" | "max";
export type CallOptions = { effort?: Effort };
/** Longest reply per effort level. */
const OUTPUT_FOR: Record<Effort, number> = { auto: 8192, low: 4096, medium: 8192, high: 16000, max: 32000 };
const TIMEOUT_FOR: Record<Effort, number> = { auto: 120_000, low: 90_000, medium: 120_000, high: 240_000, max: 480_000 };
/** cost: US dollars for this call, when the price is known. note: something the user should know (a model was replaced). */
export type Completion = RawCompletion & { model: string; fallback: boolean; ref: ModelRef; cost?: number; note?: string };

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * A theOovi call that can't go ahead: no credits, today's limit, signed out, offline,
 * a request too large... `code` lets the app show the right screen (e.g. subscribe).
 */
export class HostedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export const HOSTED_REF: ModelRef = { provider: "oovi", model: PROVIDERS.oovi.model };

const g = globalThis as typeof globalThis & { __ooviCooldown?: Map<string, number> };
const cooldown = (g.__ooviCooldown ??= new Map<string, number>());
const keyOf = (r: ModelRef) => `${r.provider}:${r.model}`;

export const modelLabel = (r: ModelRef) => `${providerName(r.provider)} · ${r.model}`;
const randomId = () => `call_${Math.random().toString(36).slice(2, 12)}`;
/** Longest reply we ask for. Without a cap some routers reserve credit for 64k+ tokens. */
const MAX_OUTPUT = 8192;
const MAX_CHAIN = 8;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** A provider the user can actually call: it has a key, or needs none and was set up. */
export function connected(s: Settings, p: ProviderId): boolean {
  if (p === "oovi") return !!sessionToken();
  const cfg = s.providers[p];
  if (!cfg) return false;
  return PROVIDERS[p].needsKey ? !!cfg.apiKey : !!(cfg.models?.length || cfg.model || cfg.baseUrl);
}

/** Every model the user switched on, across connected providers. */
export function enabledModels(s: Settings): ModelRef[] {
  const out: ModelRef[] = [];
  for (const p of Object.keys(PROVIDERS) as ProviderId[]) {
    if (!connected(s, p)) continue;
    const cfg = s.providers[p] ?? {};
    // An explicit (even empty) list wins; older settings only had one model per provider.
    const list = cfg.models ?? [cfg.model || PROVIDERS[p].model].filter(Boolean);
    for (const m of list) out.push({ provider: p, model: currentModel(s, p, m) });
  }
  return out;
}

/**
 * Who answers, in order: the bot's own model, the backups from Settings, then
 * the user's other switched-on models, so a bot is never stuck while any
 * connected model works.
 */
export function modelChain(s: Settings): ModelRef[] {
  // theOovi is one white-label model: no chain of the person's own models behind it.
  if (usesHosted(s)) return [HOSTED_REF];
  const primary: ModelRef = { provider: s.active, model: s.providers[s.active]?.model || PROVIDERS[s.active].model };
  const out: ModelRef[] = [];
  for (const r0 of [primary, ...(s.fallbacks ?? []), ...enabledModels(s)]) {
    const r = { provider: r0.provider, model: currentModel(s, r0.provider, r0.model) };
    if (r.model && r.provider in PROVIDERS && !out.some((o) => keyOf(o) === keyOf(r))) out.push(r);
    if (out.length >= MAX_CHAIN) break;
  }
  return out;
}

const MODEL_GONE = /not found|does not exist|no longer (available|supported)|unknown model|invalid model|model .*(deprecated|retired|decommissioned)|is not supported/i;

/** Plain-language reason for a failed call. */
function explain(ref: ModelRef, status: number, raw: string): string {
  const who = providerName(ref.provider);
  if (status === 401 || status === 403) return `${who} didn't accept the API key. Check it in Settings > AI models.`;
  if (status === 402) return `${who}: not enough credit on your account. ${raw}`;
  if (status === 404 || MODEL_GONE.test(raw)) return `${ref.model} isn't available at ${who} anymore.`;
  if (status === 429) return `${who} is rate-limiting your key right now. Wait a minute, or switch on another model.`;
  if (status >= 500 || status === 0) return `${who} isn't answering right now. ${raw}`;
  return `${who}: ${raw}`;
}

export async function complete(s: Settings, system: string, messages: Msg[], tools: ToolSpec[], signal?: AbortSignal, opts: CallOptions = {}): Promise<Completion> {
  const effort: Effort = opts.effort ?? "auto";
  const chain = modelChain(s);
  if (!chain.length) throw new Error("Connect an AI model in Settings > AI models.");
  const now = Date.now();
  // Cooling-down models move to the end instead of being skipped, so something is always tried.
  const ready = chain.filter((r) => (cooldown.get(keyOf(r)) ?? 0) <= now);
  const cooling = chain.filter((r) => (cooldown.get(keyOf(r)) ?? 0) > now);
  const errors: string[] = [];
  const queue = [...ready, ...cooling];
  let note: string | undefined;

  for (let qi = 0; qi < queue.length; qi++) {
    const ref = queue[qi]!;
    let maxOut = effort === "auto" ? MAX_OUTPUT : OUTPUT_FOR[effort];
    let reasoning = effort !== "auto";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const out = await callOnce(s, ref, system, messages, tools, maxOut, signal, reasoning ? effort : "auto");
        cooldown.delete(keyOf(ref));
        if (ref.provider === "oovi") return { ...out, model: out.hostedName || HOSTED_NAME, ref, fallback: false, note };
        const cost = await costOf(ref.provider, ref.model, out.usage.input, out.usage.output).catch(() => undefined);
        return { ...out, model: modelLabel(ref), ref, cost, fallback: keyOf(ref) !== keyOf(chain[0]!), note };
      } catch (e) {
        if (signal?.aborted) throw e;
        if (ref.provider === "oovi") throw hostedFailure(e);
        const status = e instanceof ProviderError ? e.status : 0;
        const retryAfter = e instanceof ProviderError ? e.retryAfter : undefined;
        const raw = (e as Error).message || String(e);
        const busy = status === 429 || status === 503 || status === 529;
        // A short "try again in a few seconds" is worth waiting for once.
        if (busy && attempt === 0 && retryAfter && retryAfter <= 8) {
          await sleep(retryAfter * 1000, signal);
          continue;
        }
        // This model doesn't take a thinking/effort setting: try again without it.
        if (reasoning && status === 400 && /reasoning|thinking|effort|output_config|budget/i.test(raw)) {
          reasoning = false;
          continue;
        }
        // Not enough credit for a long reply: ask for a shorter one.
        const afford = Number((raw.match(/can only afford (\d+)/i) ?? [])[1]);
        if (status === 402 && afford >= 1024 && afford < maxOut) {
          maxOut = Math.floor(afford * 0.9);
          continue;
        }
        // The provider retired this model: switch to its closest current model, for good.
        if ((status === 404 || (status === 400 && MODEL_GONE.test(raw))) && attempt === 0) {
          const repl = await replacementFor(ref.provider, ref.model, s).catch(() => null);
          if (repl && repl !== ref.model) {
            markRetired(ref.provider, ref.model, repl);
            replaceBotModel(ref.provider, ref.model, repl);
            note = `${ref.model} was retired by ${providerName(ref.provider)}; switched to ${repl}.`;
            (s.retired ??= {})[keyOf(ref)] = repl;
            const next = { provider: ref.provider, model: repl };
            if (!queue.some((q) => keyOf(q) === keyOf(next))) queue.splice(qi + 1, 0, next);
          }
        }
        const coolSeconds = busy
          ? Math.max(60, retryAfter ?? 0)
          : status === 404 || (status === 400 && /model|tool|function/i.test(raw))
            ? 3600
            : status === 401 || status === 403 || status === 402
              ? 600
              : status >= 500
                ? 30
                : 0;
        if (coolSeconds) cooldown.set(keyOf(ref), Date.now() + coolSeconds * 1000);
        errors.push(`${modelLabel(ref)}: ${explain(ref, status, raw)}`);
        break;
      }
    }
  }
  throw new Error(
    errors.length > 1
      ? `None of your models could answer:\n- ${errors.join("\n- ")}\nAdd or fix a model in Settings > AI models.`
      : `${errors[0] ?? "No model answered."}${chain.length === 1 ? " Tip: switch on a second model in Settings > AI models so oovi can fall back to it." : ""}`,
  );
}

const HOSTED_STATES = new Set<string>(["no_credits", "daily_limit", "suspended", "paused", "off", "blocked"]);

/** Turns a failed theOovi call into a HostedError with a clear message and code. */
function hostedFailure(e: unknown): HostedError {
  if (e instanceof HostedError) return e;
  const status = e instanceof ProviderError ? e.status : 0;
  const code = (e instanceof ProviderError && e.code) || (status === 0 ? "offline" : status === 401 ? "signed_out" : "busy");
  if (HOSTED_STATES.has(code)) noteHostedState(code as HostedState, (e as Error).message);
  if (code === "offline") noteHostedState("offline", null);
  const message =
    code === "offline"
      ? "You're offline, or the oovi service can't be reached. Check your internet connection and try again."
      : code === "signed_out"
        ? "You're signed out. Sign in again to use theOovi."
        : (e as Error).message || "theOovi couldn't answer. Try again in a minute.";
  return new HostedError(message, code);
}

async function callOnce(s: Settings, ref: ModelRef, system: string, messages: Msg[], tools: ToolSpec[], maxOut: number, signal: AbortSignal | undefined, effort: Effort): Promise<RawCompletion> {
  if (ref.provider === "oovi") {
    const timeout = AbortSignal.timeout(290_000);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return hosted({ label: HOSTED_NAME, provider: "oovi", baseUrl: cloudUrl(), model: ref.model, system, messages, tools, maxOut, effort, signal: sig });
  }
  const meta = PROVIDERS[ref.provider];
  const cfg = s.providers[ref.provider] ?? {};
  const baseUrl = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`Set a server address for ${meta.label} in Settings.`);
  if (meta.needsKey && !cfg.apiKey) throw new ProviderError(`No API key for ${meta.label}. Add one in Settings.`, 401);
  const timeout = AbortSignal.timeout(TIMEOUT_FOR[effort]);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const req: Req = { label: meta.label, provider: ref.provider, baseUrl, model: ref.model, key: cfg.apiKey, system, messages, tools, maxOut, effort, signal: sig };
  return meta.kind === "anthropic" ? anthropic(req) : openaiCompatible(req, ref.provider === "openrouter");
}

type Req = { label: string; provider: ProviderId; baseUrl: string; model: string; key?: string; system: string; messages: Msg[]; tools: ToolSpec[]; maxOut: number; effort: Effort; signal?: AbortSignal };

// ---------- thinking / effort per provider ----------

/** Claude model generation, e.g. claude-sonnet-5-5 -> 5.5, claude-haiku-4-5 -> 4.5. */
function claudeVersion(model: string): number {
  const m = model.match(/claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/);
  if (!m) return 0;
  return Number(m[1]) + Number(m[2] ?? 0) / 10;
}

/** Anthropic request fields for an effort level (thinking blocks are never sent back: see below). */
function anthropicReasoning(model: string, effort: Effort, maxOut: number): Record<string, unknown> {
  if (effort === "auto") return {};
  const v = claudeVersion(model);
  if (v >= 4.6) {
    // Adaptive thinking + effort. 4.6 has no "display"; 4.7+ hide thinking text unless asked.
    const thinking = v >= 4.7 ? { type: "adaptive", display: "summarized" } : { type: "adaptive" };
    return { thinking, output_config: { effort } };
  }
  // Older models (Haiku 4.5, Sonnet 4.5…): a fixed thinking budget, only for the higher levels.
  if (effort === "high" || effort === "max") return { thinking: { type: "enabled", budget_tokens: Math.min(effort === "max" ? 16000 : 6000, maxOut - 1024) } };
  return {};
}

/** OpenAI-compatible reasoning fields, only for models known to accept them. */
function openaiReasoning(provider: ProviderId, model: string, effort: Effort): Record<string, unknown> {
  if (effort === "auto") return {};
  const level = effort === "max" ? "high" : effort;
  if (provider === "openrouter") return { reasoning: { effort: level } };
  if (provider === "openai" && /^(o\d|gpt-5)/.test(model)) return { reasoning_effort: level };
  if (provider === "gemini" && /gemini-(2\.5|[3-9]|flash|pro)/.test(model)) return { reasoning_effort: level };
  if (provider === "xai" && /grok-3-mini/.test(model)) return { reasoning_effort: level === "medium" ? "low" : level };
  return {};
}

async function post(label: string, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if ((e as Error).name === "TimeoutError") throw new ProviderError(`${label} took too long to answer.`, 504);
    throw new ProviderError(`Could not reach ${label} at ${new URL(url).origin}: ${(e as Error).message}`, 0);
  }
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after"));
    throw new ProviderError(readableError(await res.text()) || `HTTP ${res.status}`, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return res.json();
}

// ---------- Anthropic ----------

type ABlock = Record<string, unknown>;

/** Messages, tools and system prompt in Anthropic's format, with prompt-caching marks. */
function anthropicParts(r: Req) {
  const msgs: { role: "user" | "assistant"; content: ABlock[] }[] = [];
  // Anthropic wants strictly alternating roles; merge neighbours with the same role.
  const push = (role: "user" | "assistant", blocks: ABlock[]) => {
    const last = msgs.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else msgs.push({ role, content: blocks });
  };
  for (const m of r.messages) {
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "assistant") {
      const blocks: ABlock[] = [];
      if (m.text.trim()) blocks.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      push("assistant", blocks.length ? blocks : [{ type: "text", text: "(no reply)" }]);
    } else {
      push("user", m.results.map((t) => ({ type: "tool_result", tool_use_id: t.id, content: t.content, ...(t.isError ? { is_error: true } : {}) })));
    }
  }

  // Prompt caching: mark the stable prefix (tools + system) and the conversation
  // so far. In a bot's tool loop each step re-sends the same prefix, which is
  // then billed at the cheap cached-input rate instead of full price.
  const CACHE = { type: "ephemeral" } as const;
  const lastBlock = msgs.at(-1)?.content.at(-1);
  if (lastBlock) lastBlock.cache_control = CACHE;
  const tools = r.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }) as Record<string, unknown>);
  const lastTool = tools.at(-1);
  if (lastTool) lastTool.cache_control = CACHE;
  return { messages: msgs, tools, system: [{ type: "text", text: r.system, cache_control: CACHE }] };
}

type AnthropicReply = {
  model?: string;
  content?: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  oovi?: HostedLive & { credits?: number };
};

function readAnthropic(j: AnthropicReply): RawCompletion {
  const content = j.content ?? [];
  const u = j.usage ?? {};
  return {
    text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim(),
    toolCalls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id || randomId(), name: b.name ?? "", input: b.input ?? {} })),
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 },
    // Thinking blocks are kept for the UI only and never replayed: oovi trims old
    // history to save tokens, and replayed thinking requires an unedited history.
    reasoning: content.filter((b) => b.type === "thinking" && b.thinking).map((b) => b.thinking).join("\n\n") || undefined,
  };
}

async function anthropic(r: Req): Promise<RawCompletion> {
  const p = anthropicParts(r);
  const j = (await post(
    r.label,
    `${r.baseUrl}/v1/messages`,
    { "x-api-key": r.key ?? "", "anthropic-version": "2023-06-01" },
    {
      model: r.model,
      max_tokens: r.maxOut,
      ...anthropicReasoning(r.model, r.effort, r.maxOut),
      system: p.system,
      messages: p.messages,
      ...(p.tools.length ? { tools: p.tools } : {}),
    },
    r.signal,
  )) as AnthropicReply;
  return readAnthropic(j);
}

// ---------- theOovi (the hosted model, through the oovi account service) ----------

async function hosted(r: Req): Promise<RawCompletion> {
  const token = sessionToken();
  if (!token) throw new HostedError("You're signed out. Sign in again to use theOovi.", "signed_out");
  const p = anthropicParts(r);
  let res: Response;
  try {
    res = await fetch(`${r.baseUrl}/api/v1/ai/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-oovi-version": appVersion(),
        "x-oovi-platform": process.platform,
      },
      // The server picks the model; the app only says how hard to think.
      body: JSON.stringify({ system: p.system, messages: p.messages, tools: p.tools, max_tokens: r.maxOut, ...(r.effort !== "auto" ? { effort: r.effort } : {}) }),
      signal: r.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if ((e as Error).name === "TimeoutError") throw new ProviderError("theOovi took too long to answer. Try again.", 504, undefined, "busy");
    throw new ProviderError("Can't reach the oovi service.", 0, undefined, "offline");
  }
  const text = await res.text();
  let j: (AnthropicReply & { error?: string; code?: string }) | null = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  if (!res.ok || !j) {
    const retry = Number(res.headers.get("retry-after"));
    throw new ProviderError(j?.error || `The oovi service answered with an error (${res.status}).`, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined, j?.code);
  }
  noteHosted(j.oovi, j.model);
  return { ...readAnthropic(j), credits: j.oovi?.credits, hostedName: j.model };
}

// ---------- OpenAI-compatible ----------

async function openaiCompatible(r: Req, isOpenRouter: boolean): Promise<RawCompletion> {
  const msgs: Record<string, unknown>[] = [{ role: "system", content: r.system }];
  for (const m of r.messages) {
    if (m.role === "user") msgs.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      msgs.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) }
          : {}),
      });
    } else {
      for (const t of m.results) msgs.push({ role: "tool", tool_call_id: t.id, content: t.content });
    }
  }

  const headers: Record<string, string> = {};
  if (r.key) headers.authorization = `Bearer ${r.key}`;
  if (isOpenRouter) Object.assign(headers, { "HTTP-Referer": "http://localhost", "X-Title": "oovi" });

  const j = (await post(
    r.label,
    `${r.baseUrl}/chat/completions`,
    headers,
    {
      model: r.model,
      messages: msgs,
      // OpenAI's newer models only accept max_completion_tokens.
      ...(r.provider === "openai" ? { max_completion_tokens: r.maxOut } : { max_tokens: r.maxOut }),
      ...openaiReasoning(r.provider, r.model, r.effort),
      ...(r.tools.length ? { tools: r.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    },
    r.signal,
  )) as {
    choices?: { message?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; code?: number };
  };

  // Some routers (OpenRouter) report upstream failures inside a 200 response.
  if (j.error) throw new ProviderError(j.error.message ?? "upstream error", j.error.code ?? 502);
  if (!j.choices?.length) throw new ProviderError(`${r.label} returned no answer.`, 502);

  const msg = j.choices[0]?.message ?? {};
  return {
    text: (typeof msg.content === "string" ? msg.content : "").trim(),
    toolCalls: (msg.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function?.arguments || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      return { id: c.id || randomId(), name: c.function?.name ?? "", input };
    }),
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 },
    reasoning: (msg.reasoning ?? msg.reasoning_content ?? "").trim() || undefined,
  };
}
