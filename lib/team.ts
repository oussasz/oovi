// The main bot runs the user's groups: it can see every group, give one a task,
// wait for the group's final answer and report back, so the user only talks to it.

import type { ToolSpec } from "./llm";
import { isRunning, startRun, subscribe } from "./runner";
import { dmId, getChat, listBots, listChats, newId, saveChat } from "./store";
import type { Bot, BotEntry, Chat, ToolCall, ToolResult } from "./types";

export const TEAM_SPECS: ToolSpec[] = [
  {
    name: "list_groups",
    description: "List the user's groups: name, members and their roles, who leads, and what each group is doing now.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "message_group",
    description:
      "Give one of the user's groups a task, on the user's behalf. The group works on it and you get its final answer back (for long jobs, the group's answer is posted to the user when it finishes). Write a complete, self-contained task.",
    parameters: {
      type: "object",
      properties: { group: { type: "string", description: "Group name" }, message: { type: "string" } },
      required: ["group", "message"],
    },
  },
  {
    name: "read_group",
    description: "Read a group's most recent messages, to check progress or catch up.",
    parameters: {
      type: "object",
      properties: { group: { type: "string" }, last: { type: "integer", minimum: 1, maximum: 30, description: "How many messages (default 10)" } },
      required: ["group"],
    },
  },
];

export const TEAM_TOOLS: ReadonlySet<string> = new Set(TEAM_SPECS.map((s) => s.name));

const WAIT_MS = 4 * 60 * 1000;
const LEADERISH = /lead|assistant|chef|leader|boss|قائد|مساعد/i;

/**
 * The user's main bot: the one that leads the most groups (ties: a "leader" or
 * "assistant" role, then the oldest bot).
 */
export function mainBot(bots: Bot[] = listBots(), chats: Chat[] = listChats()): Bot | undefined {
  const leads = new Map<string, number>();
  for (const c of chats) if (c.kind === "group" && c.leadId) leads.set(c.leadId, (leads.get(c.leadId) ?? 0) + 1);
  return [...bots].sort(
    (a, b) => (leads.get(b.id) ?? 0) - (leads.get(a.id) ?? 0) || Number(LEADERISH.test(b.role)) - Number(LEADERISH.test(a.role)) || a.createdAt - b.createdAt,
  )[0];
}

function findGroup(name: unknown): Chat | string {
  const groups = listChats().filter((c) => c.kind === "group");
  const q = String(name ?? "").trim().toLowerCase();
  const hit = groups.find((g) => g.name.toLowerCase() === q || g.id === q) ?? (q ? groups.find((g) => g.name.toLowerCase().includes(q)) : undefined);
  return hit ?? `No group called "${String(name ?? "")}". Groups: ${groups.map((g) => g.name).join(", ") || "none yet"}.`;
}

const nameOf = (bots: Bot[], id: string) => bots.find((b) => b.id === id)?.name ?? "a bot";

/** Final answer of the run that started at `fromEntry`, or a status line. */
function outcome(chat: Chat, fromEntry: string, bots: Bot[]): string {
  const i = chat.entries.findIndex((e) => e.id === fromEntry);
  const after = chat.entries.slice(i + 1).filter((e): e is BotEntry => e.kind === "bot");
  if (chat.pending?.approval) {
    const who = nameOf(bots, chat.pending.approval.botId);
    return `The group "${chat.name}" is waiting for the user's approval: ${who} wants to ${chat.pending.approval.items.map((x) => x.summary).join("; ")}. Tell the user to open the group "${chat.name}" to approve or deny.`;
  }
  const last = [...after].reverse().find((e) => e.text || e.error);
  if (!last) return `The group "${chat.name}" didn't answer.`;
  if (last.status === "error") return `${nameOf(bots, last.botId)} in "${chat.name}" hit a problem: ${last.error ?? "unknown error"}`;
  return `Final answer from ${nameOf(bots, last.botId)} in "${chat.name}":\n${last.text.slice(0, 8000)}`;
}

/** Wait for a group's run to end (or the time limit). Resolves true when it ended. */
function waitForRun(chatId: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let unsub: (() => void) | null = null;
    const t = setTimeout(() => {
      unsub?.();
      resolve(false);
    }, ms);
    unsub = subscribe(chatId, (e) => {
      if (e.type === "done") {
        clearTimeout(t);
        unsub?.();
        resolve(true);
      }
    });
    if (!unsub) {
      clearTimeout(t);
      resolve(true);
    }
  });
}

// ---------- reports to the user ----------

type ReportSink = (text: string) => void;
const g = globalThis as typeof globalThis & { __ooviReportSinks?: Set<ReportSink> };
const sinks = (g.__ooviReportSinks ??= new Set<ReportSink>());

/** Also send the main bot's reports somewhere else (e.g. Telegram). */
export function onReport(fn: ReportSink): () => void {
  sinks.add(fn);
  return () => {
    sinks.delete(fn);
  };
}

/** Post a message from the main bot into its own chat (no model call), and forward it. */
export async function postReport(text: string): Promise<void> {
  const bot = mainBot();
  if (!bot) return;
  const id = dmId(bot.id);
  // Don't write into the chat while a run there holds it in memory.
  for (let i = 0; i < 300 && isRunning(id); i++) await new Promise((r) => setTimeout(r, 2000));
  const chat = getChat(id);
  if (!chat) return;
  const entry: BotEntry = { id: newId(), kind: "bot", botId: bot.id, at: Date.now(), steps: [], text, status: "done", usage: { input: 0, output: 0 } };
  chat.entries.push(entry);
  saveChat(chat);
  for (const s of sinks) {
    try {
      s(text);
    } catch {
      /* a sink must not break reporting */
    }
  }
}

// ---------- tools ----------

export async function runTeamTool(call: ToolCall, self: Bot): Promise<ToolResult> {
  const ok = (content: string): ToolResult => ({ id: call.id, name: call.name, content });
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const bots = listBots();

  if (call.name === "list_groups") {
    const groups = listChats().filter((c) => c.kind === "group");
    if (!groups.length) return ok("The user has no groups yet.");
    return ok(
      groups
        .map((c) => {
          const members = c.memberIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is Bot => !!b);
          const last = [...c.entries].reverse().find((e) => e.kind === "user" || e.text);
          const state = isRunning(c.id) ? "working now" : c.pending?.approval ? "waiting for the user's approval" : "idle";
          const preview = last ? `${last.kind === "user" ? "user" : nameOf(bots, last.botId)}: ${last.text.replace(/\s+/g, " ").slice(0, 140)}` : "no messages yet";
          return `- ${c.name} (${state}). Leader: ${nameOf(bots, c.leadId ?? members[0]?.id ?? "")}. Members: ${members.map((m) => `${m.name}${m.role ? ` (${m.role})` : ""}`).join(", ")}. Last: ${preview}`;
        })
        .join("\n"),
    );
  }

  const group = findGroup(call.input.group);
  if (typeof group === "string") return bad(group);

  if (call.name === "read_group") {
    const n = Math.min(30, Math.max(1, Number(call.input.last) || 10));
    const items = group.entries.filter((e) => e.kind === "user" || e.text).slice(-n);
    if (!items.length) return ok(`"${group.name}" has no messages yet.`);
    return ok(items.map((e) => `[${e.kind === "user" ? (e.via ? `${nameOf(bots, e.via)} for the user` : "User") : nameOf(bots, e.botId)}]: ${e.text.slice(0, 1500)}`).join("\n\n"));
  }

  if (call.name === "message_group") {
    const message = String(call.input.message ?? "").trim();
    if (!message) return bad("message is required");
    if (isRunning(group.id)) return bad(`"${group.name}" is still working on something. Check it with read_group, or try again in a minute.`);
    const known = new Set(group.entries.map((e) => e.id));
    if (!startRun(group.id, { text: message, via: self.id })) return bad(`"${group.name}" is busy right now.`);
    const finished = await waitForRun(group.id, WAIT_MS);
    const after = getChat(group.id);
    if (!after) return bad("The group was deleted.");
    const sent = after.entries.find((e) => !known.has(e.id) && e.kind === "user" && e.via === self.id);
    if (!sent) return bad("The message couldn't be delivered.");
    if (finished) return ok(outcome(after, sent.id, bots));
    // Long job: report to the user when the group is done.
    void waitForRun(group.id, 60 * 60 * 1000).then(() => {
      const done = getChat(group.id);
      if (done) void postReport(`**${group.name}** finished.\n\n${outcome(done, sent.id, listBots()).replace(/^Final answer from [^\n]*\n/, "")}`);
    });
    return ok(`"${group.name}" is still working on it. Its answer will be posted to the user automatically when it's done. Tell the user that.`);
  }

  return bad(`Unknown tool: ${call.name}`);
}
