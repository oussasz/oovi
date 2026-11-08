// Talks to model providers with plain fetch and the user's own keys.
// Two wire formats: Anthropic Messages, and OpenAI-compatible chat completions
// (OpenAI, xAI, Gemini, OpenRouter, Groq, DeepSeek, Mistral, Ollama, …).
//
// Reliability: every call goes through a model chain (the bot's model first,
// then the backups from Settings). If a model is rate-limited, down, missing,
// can't use tools, or times out, the next one answers instead, and the failing
// one "cools down" for a while so later calls skip straight past it.

import { PROVIDERS, providerName } from "./providers-meta";
import type { ModelRef, Settings } from "./settings";
import type { Msg, ToolCall } from "./types";

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
type RawCompletion = { text: string; toolCalls: ToolCall[]; usage: { input: number; output: number } };
export type Completion = RawCompletion & { model: string; fallback: boolean };

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const g = globalThis as typeof globalThis & { __ooviCooldown?: Map<string, number> };
const cooldown = (g.__ooviCooldown ??= new Map<string, number>());
const keyOf = (r: ModelRef) => `${r.provider}:${r.model}`;

export const modelLabel = (r: ModelRef) => `${providerName(r.provider)} · ${r.model}`;
const randomId = () => `call_${Math.random().toString(36).slice(2, 12)}`;

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

/** The bot's own model first, then the backups, without duplicates. */
export function modelChain(s: Settings): ModelRef[] {
  const primary: ModelRef = { provider: s.active, model: s.providers[s.active]?.model || PROVIDERS[s.active].model };
  const out: ModelRef[] = [];
  for (const r of [primary, ...(s.fallbacks ?? [])]) {
    if (r.model && r.provider in PROVIDERS && !out.some((o) => keyOf(o) === keyOf(r))) out.push(r);
  }
  return out;
}

export async function complete(s: Settings, system: string, messages: Msg[], tools: ToolSpec[], signal?: AbortSignal): Promise<Completion> {
  const chain = modelChain(s);
  if (!chain.length) throw new Error("Pick a model in Settings.");
  const now = Date.now();
  // Cooling-down models move to the end instead of being skipped, so something is always tried.
  const ready = chain.filter((r) => (cooldown.get(keyOf(r)) ?? 0) <= now);
  const cooling = chain.filter((r) => (cooldown.get(keyOf(r)) ?? 0) > now);
  const errors: string[] = [];

  for (const ref of [...ready, ...cooling]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await callOnce(s, ref, system, messages, tools, signal);
        cooldown.delete(keyOf(ref));
        return { ...out, model: modelLabel(ref), fallback: keyOf(ref) !== keyOf(chain[0]!) };
      } catch (e) {
        if (signal?.aborted) throw e;
        const status = e instanceof ProviderError ? e.status : 0;
        const retryAfter = e instanceof ProviderError ? e.retryAfter : undefined;
        const msg = (e as Error).message || String(e);
        const busy = status === 429 || status === 503 || status === 529;
        // A short "try again in a few seconds" is worth waiting for once.
        if (busy && attempt === 0 && retryAfter && retryAfter <= 8) {
          await sleep(retryAfter * 1000, signal);
          continue;
        }
        const coolSeconds = busy
          ? Math.max(60, retryAfter ?? 0)
          : status === 404 || (status === 400 && /model|tool|function/i.test(msg))
            ? 3600
            : status === 401 || status === 403
              ? 600
              : status >= 500
                ? 30
                : 0;
        if (coolSeconds) cooldown.set(keyOf(ref), Date.now() + coolSeconds * 1000);
        errors.push(`${modelLabel(ref)}: ${(msg.split("\n")[0] ?? msg).slice(0, 240)}`);
        break;
      }
    }
  }
  throw new Error(errors.length > 1 ? `Every model in your chain failed:\n- ${errors.join("\n- ")}` : (errors[0] ?? "No model answered."));
}

async function callOnce(s: Settings, ref: ModelRef, system: string, messages: Msg[], tools: ToolSpec[], signal?: AbortSignal): Promise<RawCompletion> {
  const meta = PROVIDERS[ref.provider];
  const cfg = s.providers[ref.provider] ?? {};
  const baseUrl = (cfg.baseUrl || meta.baseUrl).replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`Set a base URL for ${meta.label} in Settings.`);
  if (meta.needsKey && !cfg.apiKey) throw new Error(`No API key for ${meta.label}. Add one in Settings.`);
  const timeout = AbortSignal.timeout(120_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const req: Req = { label: meta.label, baseUrl, model: ref.model, key: cfg.apiKey, system, messages, tools, signal: sig };
  return meta.kind === "anthropic" ? anthropic(req) : openaiCompatible(req, ref.provider === "openrouter");
}

type Req = { label: string; baseUrl: string; model: string; key?: string; system: string; messages: Msg[]; tools: ToolSpec[]; signal?: AbortSignal };

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
    throw new ProviderError(`${label} returned ${res.status}: ${(await res.text()).slice(0, 400)}`, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return res.json();
}

// ---------- Anthropic ----------

type ABlock = Record<string, unknown>;

async function anthropic(r: Req): Promise<RawCompletion> {
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
  const lastMsg = msgs.at(-1);
  const lastBlock = lastMsg?.content.at(-1);
  if (lastBlock) lastBlock.cache_control = CACHE;
  const tools = r.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }) as Record<string, unknown>);
  const lastTool = tools.at(-1);
  if (lastTool) lastTool.cache_control = CACHE;

  const j = (await post(
    r.label,
    `${r.baseUrl}/v1/messages`,
    { "x-api-key": r.key ?? "", "anthropic-version": "2023-06-01" },
    {
      model: r.model,
      max_tokens: 8192,
      system: [{ type: "text", text: r.system, cache_control: CACHE }],
      messages: msgs,
      ...(tools.length ? { tools } : {}),
    },
    r.signal,
  )) as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const content = j.content ?? [];
  return {
    text: content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim(),
    toolCalls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id || randomId(), name: b.name ?? "", input: b.input ?? {} })),
    usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 },
  };
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
      ...(r.tools.length ? { tools: r.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    },
    r.signal,
  )) as {
    choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; code?: number };
  };

  // Some routers (OpenRouter) report upstream failures inside a 200 response.
  if (j.error) throw new ProviderError(`${r.label}: ${j.error.message ?? "upstream error"}`, j.error.code ?? 502);
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
  };
}
