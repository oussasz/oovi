// Anonymous usage statistics: daily counts of what the app did (messages,
// replies, tools, tokens, files…), never content. Kept on this computer in
// usage.json and sent to the oovi account service now and then so the oovi
// team can see what's used. Off with "Share usage statistics" in Settings.

import fs from "node:fs";
import path from "node:path";
import { appVersion, cloud, sessionToken } from "./account";
import { listServers } from "./mcp";
import { dataDir, loadSettings } from "./settings";
import { listSkills } from "./skills";
import { listBots, listChats } from "./store";
import type { ToolCall, ToolResult } from "./types";

export type UsageCounts = {
  messages: number;
  botReplies: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  filesCreated: number;
  searches: number;
  sandboxRuns: number;
  webPages: number;
};
const KEYS: (keyof UsageCounts)[] = ["messages", "botReplies", "toolCalls", "tokensIn", "tokensOut", "costUsd", "filesCreated", "searches", "sandboxRuns", "webPages"];

type Store = { days: Record<string, Partial<UsageCounts>>; sent: Record<string, number> };
const file = () => path.join(dataDir(), "usage.json");
const KEEP_DAYS = 14;

/** Local date as YYYY-MM-DD. */
export function dayOf(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function read(): Store {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<Store>;
    return { days: j.days ?? {}, sent: j.sent ?? {} };
  } catch {
    return { days: {}, sent: {} };
  }
}

function write(s: Store) {
  const days = Object.keys(s.days).sort().slice(-KEEP_DAYS);
  const keep: Store = { days: Object.fromEntries(days.map((d) => [d, s.days[d] ?? {}])), sent: Object.fromEntries(Object.entries(s.sent).filter(([d]) => days.includes(d))) };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(keep));
}

/** Add to today's counts. Never throws. */
export function countUsage(delta: Partial<UsageCounts>): void {
  try {
    const s = read();
    const today = dayOf();
    const cur = (s.days[today] ??= {});
    let changed = false;
    for (const k of KEYS) {
      const v = delta[k];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        cur[k] = (cur[k] ?? 0) + v;
        changed = true;
      }
    }
    if (changed) write(s);
  } catch {
    /* statistics must never break the app */
  }
}

const SEARCH = new Set(["web_search", "research"]);
const PAGES = new Set(["open_url", "read_url", "read_page"]);

/** Count one step's tool calls. */
export function countTools(calls: ToolCall[], results: ToolResult[]): void {
  countUsage({
    toolCalls: calls.length,
    searches: calls.filter((c) => SEARCH.has(c.name)).length,
    webPages: calls.filter((c) => PAGES.has(c.name)).length,
    sandboxRuns: calls.filter((c) => c.name === "vm_run").length,
    filesCreated: results.filter((r) => r.file && !r.isError).length,
  });
}

function totals() {
  try {
    return {
      bots: listBots().length,
      groups: listChats().filter((c) => c.kind === "group").length,
      connectors: listServers().length,
      skills: listSkills().length,
    };
  } catch {
    return undefined;
  }
}

/** Send the days not reported yet, plus today's running count. Returns how many days were sent. */
export async function reportUsage(): Promise<number> {
  if (!sessionToken()) return 0;
  if (loadSettings().usageStats === false) return 0;
  const s = read();
  const today = dayOf();
  const oldest = dayOf(new Date(Date.now() - 13 * 86_400_000));
  const sentNow: Record<string, number> = {};
  for (const day of Object.keys(s.days).sort()) {
    if (day < oldest) continue;
    if (day !== today && s.sent[day]) continue;
    const c = s.days[day] ?? {};
    const counts = Object.fromEntries(KEYS.map((k) => [k, k === "costUsd" ? Math.round((c[k] ?? 0) * 1e6) / 1e6 : Math.round(c[k] ?? 0)]));
    try {
      await cloud("/api/v1/usage", { method: "POST", auth: true, body: { day, appVersion: appVersion(), platform: process.platform, counts, totals: totals() } });
      sentNow[day] = Date.now();
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      if (status === 400) sentNow[day] = Date.now(); // the server will never take it: don't retry forever
      else break; // offline, signed out or server trouble: try again later
    }
  }
  try {
    // Re-read so counts added while sending aren't lost.
    const now = read();
    now.sent = { ...now.sent, ...sentNow };
    write(now);
  } catch {
    /* ignore */
  }
  return Object.keys(sentNow).length;
}

const g = globalThis as unknown as { __ooviUsageTimer?: ReturnType<typeof setInterval> };

/** Report a minute after start, then every 6 hours. */
export function startUsageReporter(): void {
  if (g.__ooviUsageTimer) return;
  const tick = () => void reportUsage().catch(() => {});
  setTimeout(tick, 60_000).unref?.();
  g.__ooviUsageTimer = setInterval(tick, 6 * 60 * 60_000);
  g.__ooviUsageTimer.unref?.();
}
