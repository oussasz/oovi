// Messages the user sends while bots are working (no 409 "still working" any more). They wait here and the
// working bot reads them before its next step (lib/orchestrator.ts takes them in), so the user can correct
// or add to a task without stopping it. Whatever is still waiting when the run ends (it finished, or the
// user pressed Stop) starts the next run, so "stop, then correct" works too. In memory: a restart loses
// only messages that were never read, and the screen still shows them as not sent.
import type { RunInput } from "./orchestrator";

const inbox = new Map<string, RunInput[]>();

/** Max messages waiting per chat. */
export const MAX_WAITING = 10;

export function addSteer(chatId: string, input: RunInput): boolean {
  const list = inbox.get(chatId) ?? [];
  if (list.length >= MAX_WAITING) return false;
  list.push(input);
  inbox.set(chatId, list);
  return true;
}

/** All waiting messages, oldest first, removed from the inbox. */
export function takeSteers(chatId: string): RunInput[] {
  const list = inbox.get(chatId) ?? [];
  inbox.delete(chatId);
  return list;
}

/** The first waiting message, removed (the rest keep waiting for the run it starts). */
export function nextSteer(chatId: string): RunInput | undefined {
  const list = inbox.get(chatId);
  const first = list?.shift();
  if (!list?.length) inbox.delete(chatId);
  return first;
}

export const waitingSteers = (chatId: string): number => inbox.get(chatId)?.length ?? 0;
