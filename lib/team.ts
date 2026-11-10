// The main bot runs the user's groups: it can see every group, give one a task,
// wait for the group's final answer and report back, so the user only talks to it.

import fs from "node:fs";
import path from "node:path";
import { groupTaskState } from "./delegations-core";
import { addDelegation, removeDelegation, toolText, updateDelegation } from "./delegations";
import type { ToolSpec } from "./llm";
import { isRunning, startRun, stopRun, whenIdle } from "./runner";
import { dataDir } from "./settings";
import { getChat, listBots, listChats, newId } from "./store";
import type { Bot, Chat, ToolCall, ToolResult } from "./types";

export { onReport } from "./delegations";

export const TEAM_SPECS: ToolSpec[] = [
  {
    name: "list_groups",
    description: "List the user's groups: name, members and their roles, who leads, and what each group is doing now.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "message_group",
    description:
      "Give one of the user's groups a task, on the user's behalf. The group works on it and you get its final answer back, with what its members said before it (for long jobs, the group's answer is posted to the user when it finishes). Write a complete, self-contained task, short, in the language of the user's latest message (the group answers in the language you write in).",
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

/** How long message_group waits for a quick answer before the task is followed in the background (delegations.ts). */
const WAIT_MS = 2 * 60 * 1000;
const LEADERISH = /lead|assistant|chef|leader|boss|قائد|مساعد/i;

const pinFile = () => path.join(dataDir(), "main.json");

/** The bot the user (or setup) made the main bot, if it still exists. */
export function pinnedMainBot(bots: Bot[] = listBots()): Bot | undefined {
  try {
    const { botId } = JSON.parse(fs.readFileSync(pinFile(), "utf8")) as { botId?: string };
    return bots.find((b) => b.id === botId);
  } catch {
    return undefined;
  }
}

export function pinMainBot(botId: string): void {
  fs.mkdirSync(path.dirname(pinFile()), { recursive: true });
  fs.writeFileSync(pinFile(), JSON.stringify({ botId }));
}

/**
 * The user's main bot: the pinned one, else the one that leads the most groups
 * (ties: a "leader" or "assistant" role, then the oldest bot).
 */
export function mainBot(bots: Bot[] = listBots(), chats: Chat[] = listChats()): Bot | undefined {
  const pinned = pinnedMainBot(bots);
  if (pinned) return pinned;
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

/** Wait for a group's run to end, the time limit, or a stop. Resolves true when the run ended. */
function waitForGroup(chatId: string, ms: number, signal?: AbortSignal): Promise<boolean> {
  if (!signal) return whenIdle(chatId, ms);
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    void whenIdle(chatId, ms).then((ended) => {
      signal.removeEventListener("abort", onAbort);
      resolve(ended);
    });
  });
}

// ---------- tools ----------

/** Where the main bot's own turn came from: the group's run inherits it (files and approvals go back there). */
export type TeamCtx = { signal?: AbortSignal; channel?: "telegram"; telegramChatId?: number };

export async function runTeamTool(call: ToolCall, self: Bot, ctx: TeamCtx = {}): Promise<ToolResult> {
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
    // Members that hit a problem are listed too, so nobody is reported as "didn't answer" by mistake.
    const items = group.entries.filter((e) => e.kind === "user" || e.text || (e.kind === "bot" && e.status === "error")).slice(-n);
    if (!items.length) return ok(`"${group.name}" has no messages yet.`);
    const body = (t: string) => (t.length > 1500 ? `${t.slice(0, 1500)}… [${t.length - 1500} more characters]` : t);
    return ok(
      items
        .map((e) =>
          e.kind === "user"
            ? `[${e.via ? `${nameOf(bots, e.via)} for the user` : "User"}]: ${body(e.text)}`
            : `[${nameOf(bots, e.botId)}]: ${e.text ? body(e.text) : ""}${e.status === "error" ? `${e.text ? "\n" : ""}(hit a problem: ${e.error ?? "unknown error"})` : ""}`,
        )
        .join("\n\n"),
    );
  }

  if (call.name === "message_group") {
    const message = String(call.input.message ?? "").trim();
    if (!message) return bad("message is required");
    if (isRunning(group.id)) return bad(`"${group.name}" is still working on something. Check it with read_group, or try again in a minute.`);
    // A new message would cancel what the group is waiting for the user to answer.
    if (group.pending?.approval || group.pending?.planReview) {
      const what = group.pending.approval ? `its OK for: ${group.pending.approval.items.map((x) => x.summary).join("; ")}` : "their review of its plan";
      return bad(`"${group.name}" is waiting for the user's answer on its last task (${what}). Tell the user; send it a new task only after they've answered.`);
    }
    const telegram = ctx.channel === "telegram" && typeof ctx.telegramChatId === "number" ? { channel: "telegram" as const, telegramChatId: ctx.telegramChatId } : undefined;
    const sentEntryId = newId();
    if (!startRun(group.id, { text: message, via: self.id, entryId: sentEntryId, ...(telegram ?? {}) })) return bad(`"${group.name}" is busy right now.`);
    // On disk from the start: if this turn ends early (stop, crash, restart), the result still reaches the user.
    const task = addDelegation({ groupId: group.id, groupName: group.name, sentEntryId, mainBotId: self.id, ...(telegram ? { origin: telegram } : {}), startedAt: Date.now(), inline: true });
    await waitForGroup(group.id, WAIT_MS, ctx.signal);
    if (ctx.signal?.aborted) {
      stopRun(group.id);
      removeDelegation(task.id);
      return bad("Stopped by the user.");
    }
    const after = getChat(group.id);
    if (!after) {
      removeDelegation(task.id);
      return bad("The group was deleted.");
    }
    const state = groupTaskState(after, sentEntryId, isRunning(group.id));
    const text = toolText(state, group.name, listBots(), !!telegram);
    if (state.kind === "running") {
      // Long job: followed in the background; its answer is posted when it's done.
      updateDelegation(task.id, (d) => (d.inline = false));
    } else if (state.kind === "approval" || state.kind === "plan") {
      // This turn tells the user what the group needs; the final answer comes later.
      updateDelegation(task.id, (d) => {
        d.inline = false;
        d.notified = state.key;
        d.notifiedAt = Date.now();
      });
    } else {
      removeDelegation(task.id);
    }
    return state.kind === "gone" || state.kind === "empty" ? bad(text) : ok(text);
  }

  return bad(`Unknown tool: ${call.name}`);
}
