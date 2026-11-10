// Where a task the main bot gave a group stands, read from the group's chat. Pure: no
// imports from the rest of oovi (types only), so it can be tested on a plain chat object.

import type { BotEntry, Chat } from "./types";

/** A finished message from a group member, sent along with the group's answer. */
export type Earlier = { botId: string; text: string };

export type GroupTaskState =
  | { kind: "running" }
  | { kind: "gone" } // the task's message was removed (chat cleared or deleted)
  | { kind: "superseded" } // the user wrote in the group before it finished: the task is theirs now
  | { kind: "approval"; key: string; botId: string; items: { summary: string; detail?: string }[] }
  | { kind: "plan"; key: string; botId: string; goal: string; steps: string[] }
  | { kind: "done"; botId: string; text: string; earlier?: Earlier[]; omitted?: number }
  | { kind: "error"; botId?: string; error: string; partial?: string; earlier?: Earlier[]; omitted?: number }
  | { kind: "stopped"; botId?: string; partial?: string; earlier?: Earlier[]; omitted?: number }
  | { kind: "cancelled" } // the user cancelled the group's proposed plan
  | { kind: "empty" };

/** A bot entry still marked "running" though no run holds the chat: the app closed or crashed mid-run. */
export const INTERRUPTED = "oovi closed before this finished. Send a message to continue.";

/**
 * The state of the task that started with the user entry `sentId` in a group chat.
 * running: whether a run holds that chat right now.
 */
export function groupTaskState(chat: Chat, sentId: string, running: boolean): GroupTaskState {
  const i = chat.entries.findIndex((e) => e.id === sentId);
  if (i < 0) return { kind: "gone" };
  const later = chat.entries.slice(i + 1);
  if (later.some((e) => e.kind === "user")) return { kind: "superseded" };
  if (running) return { kind: "running" };
  const work = later.filter((e): e is BotEntry => e.kind === "bot");
  const ids = new Set(work.map((e) => e.id));

  const approval = chat.pending?.approval;
  if (approval && ids.has(approval.entryId)) {
    return {
      kind: "approval",
      key: `approval:${approval.entryId}:${approval.at}`,
      botId: approval.botId,
      items: approval.items.map((x) => ({ summary: x.summary, ...(x.detail ? { detail: x.detail } : {}) })),
    };
  }
  const review = chat.pending?.planReview;
  if (review && ids.has(review.entryId)) {
    const e = work.find((x) => x.id === review.entryId);
    return { kind: "plan", key: `plan:${review.entryId}`, botId: review.botId, goal: e?.text ?? "", steps: (e?.plan ?? []).map((p) => p.text) };
  }

  const last = work.at(-1);
  if (!last) return { kind: "empty" };
  // The last finished message before the end, for a stop or failure part-way.
  const lastDone = [...work].reverse().find((e) => e.text && e.status === "done");
  /** What the other members said too: the useful part (a link, a figure) is often not in the last message. */
  const others = (skip: BotEntry | undefined) => {
    const all = work.filter((e) => e !== skip && e !== last && e.status === "done" && e.text.trim());
    const earlier = all.slice(-EARLIER_MAX).map((e) => ({ botId: e.botId, text: e.text }));
    const omitted = all.length - earlier.length;
    return { ...(earlier.length ? { earlier } : {}), ...(omitted > 0 ? { omitted } : {}) };
  };
  if (last.status === "running" || last.status === "waiting") return { kind: "error", botId: last.botId, error: INTERRUPTED, partial: lastDone?.text, ...others(lastDone) };
  if (last.status === "error") return { kind: "error", botId: last.botId, error: last.error ?? "unknown error", partial: lastDone?.text, ...others(lastDone) };
  if (last.status === "stopped") return { kind: "stopped", botId: last.botId, partial: last.text || lastDone?.text, ...others(last.text ? undefined : lastDone) };
  if (last.planReview === "cancelled") return { kind: "cancelled" };
  const final = last.text ? last : lastDone;
  if (!final) return { kind: "empty" };
  return { kind: "done", botId: final.botId, text: final.text, ...others(final) };
}

/** At most this many earlier group messages go back to the main bot with the final answer. */
export const EARLIER_MAX = 8;

/**
 * Bot entries a run left as "running" or "waiting" with nothing to resume them (the app closed
 * mid-run). Marks them as errors so the chat doesn't show "working…" forever. Returns whether
 * anything changed. Call only for a chat no run holds.
 */
export function healInterrupted(chat: Chat): boolean {
  let changed = false;
  const pendingEntry = chat.pending?.approval?.entryId ?? chat.pending?.planReview?.entryId;
  for (const e of chat.entries) {
    if (e.kind !== "bot") continue;
    if (e.status === "running" || (e.status === "waiting" && e.id !== pendingEntry)) {
      e.status = "error";
      e.error = INTERRUPTED;
      changed = true;
    }
  }
  // A queue of bots that never got their turn: nothing will pick it up.
  if (chat.pending && !chat.pending.approval && !chat.pending.planReview) {
    chat.pending = undefined;
    changed = true;
  }
  return changed;
}

/** Plain text for Telegram, which shows our messages without Markdown. */
export function plainText(md: string): string {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
