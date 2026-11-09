// Keeps every model call small without forgetting anything.
//
//  1. Summary: when a chat grows, older turns are condensed into a running summary
//     (compactIfLong in the orchestrator). The full history stays saved on disk.
//  2. recall_history: bots can search the full saved history whenever they need a
//     detail the summary left out, so nothing is lost, only out of view.
//  3. fitBudget: a last guard right before each call. If a long tool loop still goes
//     over the budget, older tool results and inputs are shortened, then the oldest
//     steps are folded away, always keeping tool calls and their results together.
//
// theOovi requests must stay under the limit set in the console (100K tokens by
// default); the budget leaves room for the reply and for estimation error.
import { attachmentTokens } from "./attachments";
import type { ToolSpec } from "./llm";
import type { AttachRef, Bot, Chat, Msg } from "./types";

/** About 3 characters per token for Claude 5.x tokenizers (the same rule the server uses). */
export const estimateTokens = (v: unknown): number => Math.ceil((typeof v === "string" ? v.length : JSON.stringify(v ?? "").length) / 3);

/** Attachments count by what they really cost (an image about 1,600 tokens, a PDF page about 1,500), never by base64 length. */
function filesTokens(messages: Msg[]): number {
  let n = 0;
  const add = (refs?: AttachRef[]) => refs?.forEach((r) => (n += attachmentTokens(r)));
  for (const m of messages) {
    if (m.role === "user") add(m.attachments);
    else if (m.role === "tool") m.results.forEach((t) => add(t.attach));
  }
  return n;
}

export function requestTokens(system: string, messages: Msg[], tools: ToolSpec[]): number {
  return estimateTokens(system) + estimateTokens(messages) + filesTokens(messages) + estimateTokens(tools);
}

/** Attachments become one-line mentions (read_attachment brings them back). keepLast: leave the newest message with files whole. */
function briefFiles(messages: Msg[], keepLast: boolean): Msg[] {
  const last = keepLast ? messages.map((m, i) => (m.role === "user" && m.attachments?.length ? i : -1)).filter((i) => i >= 0).at(-1) : -1;
  return messages.map((m, i): Msg => {
    if (m.role === "user" && m.attachments?.length && i !== last) return { ...m, attachments: m.attachments.map((a) => ({ ...a, brief: true })) };
    if (m.role === "tool" && m.results.some((t) => t.attach?.length) && !(keepLast && i === messages.length - 1)) return { role: "tool", results: m.results.map((t) => ({ ...t, attach: undefined })) };
    return m;
  });
}

/** Token budget for one request: theOovi's limit with a safety margin, or a generous cap for own keys. */
export function budgetFor(hosted: boolean, hostedMax: number): number {
  return hosted ? Math.floor(hostedMax * 0.8) : 160_000;
}

/** When to start condensing the conversation (well before the request budget). */
export const compactAtFor = (budget: number) => Math.floor(budget * 0.45);

const cut = (s: string, n: number, note: string) => (s.length > n ? `${s.slice(0, n)}\n[${note}]` : s);

function shrinkInput(input: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === "string" && v.length > max ? `${v.slice(0, max)}… [shortened; ${v.length} characters in the saved history]` : v;
  }
  return out;
}

const SUMMARY_MARK = "[Summary of the earlier conversation]";

/**
 * Makes a bot's view of the conversation fit the budget. In order, until it fits:
 * shorten older tool results, shorten long tool inputs (file contents…), then fold the
 * oldest messages into one note that points at recall_history.
 */
export function fitBudget(system: string, messages: Msg[], tools: ToolSpec[], budget: number): Msg[] {
  if (requestTokens(system, messages, tools) <= budget) return messages;
  let msgs = messages;
  // Files in older messages go first (they're the biggest), then even the newest ones.
  for (const keepLast of [true, false]) {
    msgs = briefFiles(msgs, keepLast);
    if (requestTokens(system, msgs, tools) <= budget) return msgs;
  }
  const lastTool = msgs.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;

  for (const max of [400, 150]) {
    const total = msgs.length;
    msgs = msgs.map((m, i): Msg =>
      m.role === "tool" && i !== lastTool
        ? { role: "tool", results: m.results.map((r) => ({ ...r, content: cut(r.content, max, "older result shortened; use recall_history or run the tool again for details") })) }
        : m.role === "assistant" && i < total - 2
          ? { ...m, toolCalls: m.toolCalls.map((c) => ({ ...c, input: shrinkInput(c.input, max * 2) })) }
          : m,
    );
    if (requestTokens(system, msgs, tools) <= budget) return msgs;
  }

  // Fold the oldest messages away. Only cut right before a user or assistant message,
  // never between a tool call and its result.
  const head = msgs[0]?.role === "user" && msgs[0].content.startsWith(SUMMARY_MARK) ? 1 : 0;
  let from = head;
  while (from < msgs.length - 2) {
    from += Math.max(1, Math.floor((msgs.length - from) / 6));
    while (from < msgs.length && msgs[from]!.role === "tool") from++;
    const note: Msg = {
      role: "user",
      content: `[${from - head} earlier messages of this conversation are hidden to save space. They're saved: use recall_history to look anything up.]`,
    };
    const next: Msg[] = [...msgs.slice(0, head), note, ...msgs.slice(from)];
    if (requestTokens(system, next, tools) <= budget || from >= msgs.length - 2) return next;
  }
  return msgs;
}

// ---------- recall_history ----------

export const HISTORY_SPEC: ToolSpec = {
  name: "recall_history",
  description:
    "Search the full saved history of this conversation, including parts that were summarized or hidden to save space: earlier messages, what teammates said, and what tools returned. Use it when you need an exact detail (a number, a name, a link, a file, a decision) that isn't in view.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words to look for, e.g. 'budget total' or 'hotel booking link'." },
    },
    required: ["query"],
  },
};

type Hit = { score: number; at: number; text: string };

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/** The best matching snippets from the whole saved conversation. */
export function recallHistory(chat: Chat, bots: Bot[], query: string): string {
  const q = [...new Set(words(query))];
  if (!q.length) return "Give a few words to search for.";
  const name = (id?: string) => bots.find((b) => b.id === id)?.name ?? "Bot";
  const hits: Hit[] = [];
  const consider = (text: string, label: string, at: number) => {
    if (!text) return;
    const lower = text.toLowerCase();
    let score = 0;
    let first = -1;
    for (const w of q) {
      const i = lower.indexOf(w);
      if (i >= 0) {
        score++;
        if (first < 0 || i < first) first = i;
      }
    }
    if (!score) return;
    const start = Math.max(0, first - 300);
    const snippet = text.slice(start, start + 900).trim();
    hits.push({ score, at, text: `${label}${start > 0 ? "…" : ""}${snippet}${start + 900 < text.length ? "…" : ""}` });
  };
  for (const e of chat.entries) {
    const when = new Date(e.at).toISOString().slice(0, 16).replace("T", " ");
    if (e.kind === "user") consider(`${e.text}${e.attachments?.length ? ` [attached: ${e.attachments.map((a) => a.name).join(", ")}]` : ""}`, `[${when}] User: `, e.at);
    else {
      consider(e.text, `[${when}] ${name(e.botId)}: `, e.at);
      for (const st of e.steps) {
        if (st.role === "assistant") for (const c of st.toolCalls) consider(`${c.name} ${JSON.stringify(c.input)}`, `[${when}] ${name(e.botId)} used `, e.at);
        if (st.role === "tool") for (const r of st.results) consider(r.content, `[${when}] Result of ${r.name}: `, e.at);
      }
    }
  }
  if (!hits.length) return `Nothing in this conversation's history matches “${query}”.`;
  hits.sort((a, b) => b.score - a.score || b.at - a.at);
  return hits
    .slice(0, 6)
    .map((h) => h.text)
    .join("\n\n---\n\n")
    .slice(0, 6000);
}

/** What a bot reply did with tools, in one short line (kept in the summary). */
export function activityLine(e: Chat["entries"][number]): string {
  if (e.kind !== "bot") return "";
  const done: string[] = [];
  for (const st of e.steps) {
    if (st.role !== "assistant") continue;
    for (const c of st.toolCalls) {
      const i = c.input;
      const detail = [i.filename, i.path, i.url, i.query, i.title, i.name].find((v) => typeof v === "string" && v) as string | undefined;
      done.push(detail ? `${c.name}(${detail.slice(0, 120)})` : c.name);
    }
  }
  return done.length ? ` [tools: ${[...new Set(done)].slice(0, 15).join(", ")}]` : "";
}
