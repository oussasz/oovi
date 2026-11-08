// Browser-side helpers.
import type { Mood } from "./faces";
import type { BotEntry, Chat, ChatEvent } from "./types";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    let msg = "";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      msg = "";
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Read an NDJSON event stream until it ends. */
export async function readEvents(res: Response, on: (e: ChatEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    let msg = "";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      msg = "";
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) on(JSON.parse(line) as ChatEvent);
    }
  }
}

/** Ask the sidebar to reload its lists. */
export const refreshSidebar = () => window.dispatchEvent(new Event("oovi:refresh"));

export function entryMood(e: BotEntry, isLast: boolean): Mood {
  if (e.status === "waiting") return "asking";
  if (e.status === "error") return "sad";
  if (e.status === "running") {
    const last = e.steps.at(-1);
    return last?.role === "assistant" && last.toolCalls.length ? "working" : "thinking";
  }
  if (e.status === "done" && isLast) return "happy";
  return "idle";
}

/** A bot's mood in a chat, from its latest reply. */
export function botMood(chat: Chat | null, botId: string): Mood {
  if (!chat) return "idle";
  for (let i = chat.entries.length - 1; i >= 0; i--) {
    const e = chat.entries[i];
    if (e?.kind === "bot" && e.botId === botId) return entryMood(e, i === chat.entries.length - 1);
  }
  return "idle";
}

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
