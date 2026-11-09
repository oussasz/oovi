// Browser-side helpers.
import type { Mood } from "./faces";
import { activeTag, t } from "./i18n";
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
    throw new Error(msg || t("client.requestFailed", { status: String(res.status) }));
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
    throw new Error(msg || t("client.requestFailed", { status: String(res.status) }));
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
    if (last?.role === "assistant" && last.toolCalls.length) return toolMood(last.toolCalls.at(-1)?.name ?? "");
    return "thinking";
  }
  if (e.status === "done" && isLast) return "happy";
  return "online";
}

/** "$0.0042", "$1.20", or the word for free. */
export function fmtCost(usd: number, freeLabel: string): string {
  if (usd === 0) return freeLabel;
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/** Face for the tool a bot is using: a book for searching/reading, a laptop for the browser. */
export function toolMood(tool: string): Mood {
  if (tool === "web_search" || tool === "research" || tool === "read_url" || tool === "read_document" || tool === "read_page" || tool === "use_skill" || tool === "memory" || tool === "read_file" || tool === "list_files" || tool === "search_files") return "reading";
  if (tool.startsWith("vm_")) return "computer";
  if (tool === "open_url" || tool === "click" || tool === "type" || tool === "go_back" || tool === "download_file" || tool.startsWith("mcp_")) return "computer";
  return "working";
}

const SLEEP_AFTER = 6 * 60 * 60 * 1000; // a bot nobody has used for 6 hours dozes off

/** A bot's mood in a chat, from its latest reply. */
export function botMood(chat: Chat | null, botId: string): Mood {
  if (!chat) return "online";
  for (let i = chat.entries.length - 1; i >= 0; i--) {
    const e = chat.entries[i];
    if (e?.kind === "bot" && e.botId === botId) {
      const m = entryMood(e, i === chat.entries.length - 1);
      return m === "online" && Date.now() - e.at > SLEEP_AFTER ? "sleeping" : m;
    }
  }
  return "online";
}

/** Square-crop and shrink a picked photo to a small JPEG data URL. */
export async function resizeImage(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("client.notImage")));
      i.src = url;
    });
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    c.getContext("2d")?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Time today, else a short date, in the UI language (or `locale` if given). */
export function timeLabel(ms: number, locale: string = activeTag()): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** Compact token count: 950, 1.2K, 12K (in the UI language, or `locale` if given). */
export const fmtTokens = (n: number, locale: string = activeTag()) =>
  new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: n >= 1000 && n < 10_000 ? 1 : 0 }).format(n);
