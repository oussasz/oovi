// Tasks the main bot gives groups, kept on disk until their result reaches the user.
//
// message_group waits a little for a quick answer. Past that, the task is followed here:
// whenever a run ends (and every minute, and after a restart) each open task is looked at
// again. A group that stops to ask for the user's OK or to propose a plan is announced once
// (the user can answer from Telegram's main chat); its final answer is posted in the main
// bot's chat and sent to Telegram, however long it took and even if the user approved
// something in the group in between.

import fs from "node:fs";
import path from "node:path";
import { groupTaskState, healInterrupted, INTERRUPTED, plainText, type Earlier, type GroupTaskState } from "./delegations-core";
import { translateFor } from "./i18n-server";
import { isRunning, onRunEnd } from "./runner";
import { dataDir } from "./settings";
import { dmId, getChat, listBots, listChats, newId, saveChat } from "./store";
import type { Bot, BotEntry, Chat } from "./types";

export type Delegation = {
  id: string;
  groupId: string;
  groupName: string;
  /** The task's message in the group. */
  sentEntryId: string;
  /** The main bot that gave the task; reports go to its chat. */
  mainBotId: string;
  /** Where the user asked from. */
  origin?: { channel: "telegram"; telegramChatId: number };
  startedAt: number;
  /** The main bot is still waiting for it inside its own turn, and will report the result itself. */
  inline: boolean;
  /** The approval or plan the user was last told about, so it's announced once. */
  notified?: string;
  notifiedAt?: number;
  /** A result already sent to Telegram, waiting for the main bot's chat to be free. */
  report?: string;
  /** The same result as the main bot sees it (with the other members' messages). */
  reportForModel?: string;
};

const MAX_AGE = 48 * 60 * 60 * 1000;
const MAX_OPEN = 50;
/** How long after being told about it the user can answer a group's request from Telegram's main chat. */
const ANSWER_WINDOW = 24 * 60 * 60 * 1000;

const file = () => path.join(dataDir(), "delegations.json");

function readAll(): Delegation[] {
  try {
    const list = JSON.parse(fs.readFileSync(file(), "utf8")) as unknown;
    return Array.isArray(list) ? (list as Delegation[]).filter((d) => d && typeof d.id === "string" && typeof d.groupId === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(list: Delegation[]) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX_OPEN), null, 1));
  fs.renameSync(tmp, f);
}

export function addDelegation(d: Omit<Delegation, "id">): Delegation {
  const full: Delegation = { ...d, id: newId() };
  writeAll([...readAll(), full]);
  return full;
}

export function updateDelegation(id: string, fn: (d: Delegation) => void): void {
  const list = readAll();
  const d = list.find((x) => x.id === id);
  if (!d) return;
  fn(d);
  writeAll(list);
}

export function removeDelegation(id: string): void {
  const list = readAll();
  if (list.some((d) => d.id === id)) writeAll(list.filter((d) => d.id !== id));
}

// ---------- reports to the user ----------

type ReportSink = (text: string) => void;
const g = globalThis as typeof globalThis & { __ooviReportSinks?: Set<ReportSink>; __ooviDelegations?: { timer?: ReturnType<typeof setInterval>; off?: () => void } };
const sinks = (g.__ooviReportSinks ??= new Set<ReportSink>());

/** Also send the main bot's reports somewhere else (Telegram). The sink gets plain text. */
export function onReport(fn: ReportSink): () => void {
  sinks.add(fn);
  return () => {
    sinks.delete(fn);
  };
}

function forward(text: string) {
  for (const s of sinks) {
    try {
      s(plainText(text));
    } catch (e) {
      console.error("[delegations] report sink:", (e as Error).message);
    }
  }
}

/**
 * Add a message from the main bot to its own chat (no model call). Returns false while a run
 * holds that chat (it would overwrite the message); true once written, or when there's no chat.
 */
function appendToMain(botId: string, text: string, forModel?: string): boolean {
  const id = dmId(botId);
  if (isRunning(id)) return false;
  const chat = getChat(id);
  if (!chat) return true;
  // The user sees `text`; the main bot also "remembers" the other members' messages (forModel).
  const steps: BotEntry["steps"] = forModel && forModel !== text ? [{ role: "assistant", text: forModel, toolCalls: [] }] : [];
  const entry: BotEntry = { id: newId(), kind: "bot", botId, at: Date.now(), steps, text, status: "done", usage: { input: 0, output: 0 } };
  chat.entries.push(entry);
  saveChat(chat);
  return true;
}

// ---------- wording ----------

const nameOf = (bots: Bot[], id?: string) => bots.find((b) => b.id === id)?.name ?? "A bot";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The other members' messages, for the main bot or the user (links and figures are often in them). */
function earlierBlock(state: { earlier?: Earlier[]; omitted?: number }, bots: Bot[], forModel: boolean): string {
  if (!state.earlier?.length) return "";
  const head = forModel
    ? "Earlier messages in the group (use anything useful from them, such as links or figures; they are part of the group's answer):"
    : "Also in the group:";
  const more = state.omitted ? `\n(${state.omitted} older message${state.omitted > 1 ? "s" : ""} not shown; read_group shows them.)` : "";
  return `\n\n${head}\n${state.earlier.map((m) => `[${nameOf(bots, m.botId)}]: ${clip(m.text, forModel ? 1500 : 700)}`).join("\n\n")}${more}`;
}

/** What the user is told about a group's task (in the main bot's chat and on Telegram). */
export function reportText(state: GroupTaskState, group: string, bots: Bot[], fromTelegram: boolean): string | null {
  switch (state.kind) {
    case "approval": {
      const items = state.items.map((x, i) => `${i + 1}. ${x.summary}${x.detail ? `\n${clip(x.detail, 600)}` : ""}`).join("\n");
      const how = fromTelegram ? translateFor("grp.okHowTg") : translateFor("grp.okHowApp", { group });
      return `${translateFor("grp.needsOk", { bot: nameOf(bots, state.botId), group })}\n${items}\n\n${how}`;
    }
    case "plan": {
      const steps = state.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      const how = fromTelegram ? translateFor("grp.planHowTg", { group }) : translateFor("grp.planHowApp", { group });
      return `${translateFor("grp.plan", { bot: nameOf(bots, state.botId), group })}${state.goal ? `\n${state.goal}` : ""}\n${steps}\n\n${how}`;
    }
    case "done":
      return `${translateFor("grp.done", { group, bot: nameOf(bots, state.botId) })}\n\n${clip(state.text, 8000)}`;
    case "error":
      return `${translateFor("grp.error", { group, bot: nameOf(bots, state.botId), error: state.error === INTERRUPTED ? translateFor("chat.interrupted") : state.error })}${state.partial ? `\n\n${translateFor("grp.soFar")}\n${clip(state.partial, 6000)}` : ""}`;
    case "stopped":
      return `${translateFor("grp.stopped", { group })}${state.partial ? `\n\n${translateFor("grp.soFar")}\n${clip(state.partial, 6000)}` : ""}`;
    case "empty":
      return translateFor("grp.empty", { group });
    default:
      return null; // running, cancelled, superseded, gone: nothing to tell
  }
}

/** The tool result message_group gives the main bot, for a task that ended or paused within the wait. */
export function toolText(state: GroupTaskState, group: string, bots: Bot[], fromTelegram: boolean): string {
  switch (state.kind) {
    case "approval":
      return `The group "${group}" is waiting for the user's OK: ${nameOf(bots, state.botId)} wants to ${state.items.map((x) => x.summary).join("; ")}. Tell the user what it wants. ${fromTelegram ? "They can reply /yes or /no right here in Telegram, or answer in the group in oovi." : `They answer in the group "${group}" in oovi (or with /yes or /no in Telegram).`} Its final answer will be posted to the user automatically when it's done.`;
    case "plan":
      return `The group "${group}" proposes a plan and waits for the user: ${state.goal ? `${state.goal}. ` : ""}Steps: ${state.steps.join("; ")}. Tell the user the plan in short. ${fromTelegram ? "They can reply /yes to run it or /no to cancel, right here in Telegram." : `They review it in the group "${group}" in oovi.`} Its final answer will be posted automatically when it's done.`;
    case "done":
      return `Final answer from ${nameOf(bots, state.botId)} in "${group}":\n${clip(state.text, 8000)}${earlierBlock(state, bots, true)}`;
    case "error":
      return `${nameOf(bots, state.botId)} in "${group}" hit a problem: ${state.error}${state.partial ? `\nWhat the group had so far:\n${clip(state.partial, 6000)}` : ""}${earlierBlock(state, bots, true)}`;
    case "stopped":
      return `"${group}" stopped before finishing.${state.partial ? `\nWhat it had so far:\n${clip(state.partial, 6000)}` : ""}${earlierBlock(state, bots, true)}`;
    case "cancelled":
      return `The user cancelled "${group}"'s plan.`;
    case "superseded":
      return `The user took over in "${group}" before it finished.`;
    case "gone":
      return "The message couldn't be delivered to the group.";
    case "empty":
      return `The group "${group}" didn't answer.`;
    case "running":
      return `"${group}" is still working on it. Its answer will be posted to the user automatically when it's done. Tell the user that, in a sentence.`;
  }
}

// ---------- following open tasks ----------

let checking = false;

/** A desktop notification (when the app runs in Electron), so a group waiting for the user's OK or a result isn't missed. */
function notifyDesktop(title: string, body: string, chatId: string) {
  try {
    (globalThis as typeof globalThis & { __ooviDesktop?: { notify?: (t: string, b: string, c?: string) => void } }).__ooviDesktop?.notify?.(title, plainText(body).replace(/\s+/g, " ").trim().slice(0, 240), chatId);
  } catch {
    /* notifications are a bonus */
  }
}

/** Look at every open task again: announce new requests for the user, report finished ones. */
export function checkDelegations(): void {
  if (checking) return;
  checking = true;
  try {
    const list = readAll();
    if (!list.length) return;
    const now = Date.now();
    const bots = listBots();
    const keep: Delegation[] = [];
    let changed = false;
    for (const d of list) {
      if (now - d.startedAt > MAX_AGE) {
        changed = true;
        continue;
      }
      // Finished, already sent to Telegram: waiting for the main bot's chat to be free.
      if (d.report !== undefined) {
        if (appendToMain(d.mainBotId, d.report, d.reportForModel)) changed = true;
        else keep.push(d);
        continue;
      }
      // The main bot is still waiting for it in its own turn. (If that run ended without
      // taking it over, e.g. the app closed, it's followed here from now on.)
      if (d.inline && isRunning(dmId(d.mainBotId))) {
        keep.push(d);
        continue;
      }
      if (d.inline) {
        d.inline = false;
        changed = true;
      }
      const chat = getChat(d.groupId);
      if (!chat || chat.kind !== "group") {
        changed = true;
        continue;
      }
      const state = groupTaskState(chat, d.sentEntryId, isRunning(d.groupId));
      if (state.kind === "running") {
        keep.push(d);
        continue;
      }
      const text = reportText(state, d.groupName || chat.name, bots, !!d.origin);
      if (state.kind === "approval" || state.kind === "plan") {
        if (d.notified !== state.key && text) {
          d.notified = state.key;
          d.notifiedAt = now;
          forward(text);
          notifyDesktop(d.groupName || chat.name, text, d.groupId);
          appendToMain(d.mainBotId, text); // best effort: Telegram and the notification have it either way
          changed = true;
        }
        keep.push(d);
        continue;
      }
      changed = true;
      if (!text) continue; // cancelled, superseded, gone: done, nothing to say
      forward(text);
      notifyDesktop(d.groupName || chat.name, text, d.groupId);
      // The main bot's own copy carries what the other members said (a link, a figure), so it can answer follow-ups.
      const extra = "earlier" in state ? earlierBlock(state, bots, true) : "";
      const forModel = extra ? `${text}${extra}` : undefined;
      if (!appendToMain(d.mainBotId, text, forModel)) keep.push({ ...d, report: text, ...(forModel ? { reportForModel: forModel } : {}) });
    }
    if (changed) writeAll(keep);
  } catch (e) {
    console.error("[delegations] check:", (e as Error).message);
  } finally {
    checking = false;
  }
}

/**
 * Group tasks waiting for the user's answer that they were told about recently (newest first):
 * what a "/yes" or "/no" in Telegram's main chat answers when the main bot itself isn't waiting.
 */
export function waitingGroupTasks(): { delegation: Delegation; group: Chat; kind: "approval" | "plan" }[] {
  const now = Date.now();
  const open = readAll()
    .filter((d) => d.notified && d.notifiedAt && now - d.notifiedAt < ANSWER_WINDOW)
    .sort((a, b) => (b.notifiedAt ?? 0) - (a.notifiedAt ?? 0));
  const out: { delegation: Delegation; group: Chat; kind: "approval" | "plan" }[] = [];
  for (const d of open) {
    if (isRunning(d.groupId) || out.some((w) => w.group.id === d.groupId)) continue;
    const group = getChat(d.groupId);
    if (!group) continue;
    const state = groupTaskState(group, d.sentEntryId, false);
    if ((state.kind === "approval" || state.kind === "plan") && state.key === d.notified) out.push({ delegation: d, group, kind: state.kind });
  }
  return out;
}

/** Chats a run left marked "working" when the app closed: mark them so they don't spin forever. */
export function healChats(): void {
  for (const c of listChats()) {
    if (isRunning(c.id)) continue;
    try {
      if (healInterrupted(c)) saveChat(c);
    } catch (e) {
      console.error(`[delegations] heal ${c.id}:`, (e as Error).message);
    }
  }
}

/** Start following open tasks (and repair chats left mid-run). Safe to call many times. */
export function startDelegations(): void {
  const st = (g.__ooviDelegations ??= {});
  st.off?.();
  st.off = onRunEnd(() => checkDelegations());
  if (st.timer) clearInterval(st.timer);
  st.timer = setInterval(() => checkDelegations(), 60_000);
  st.timer.unref?.();
  setTimeout(() => {
    try {
      healChats();
    } catch (e) {
      console.error("[delegations] heal:", (e as Error).message);
    }
    checkDelegations();
  }, 3_000).unref?.();
}
