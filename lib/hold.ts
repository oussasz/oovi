// The short wait before a send that had no card (lib/approval-scope-core.ts HOLD_MS): the chat shows
// "Sending in 8 s… Cancel"; POST /api/chats/<id>/hold {callId} cancels it. In memory only.
type Waiting = { cancel: () => void };
const g = globalThis as typeof globalThis & { __ooviHolds?: Map<string, Waiting> };
const holds = (g.__ooviHolds ??= new Map());

/** Waits up to ms; true if the user cancelled. */
export function waitHold(chatId: string, callId: string, ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (cancelled: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      holds.delete(`${chatId}|${callId}`);
      resolve(cancelled);
    };
    const onAbort = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    signal?.addEventListener("abort", onAbort);
    // By chat and call: teammates working at the same time can each have a send waiting.
    holds.set(`${chatId}|${callId}`, { cancel: () => finish(true) });
  });
}

/** Cancels the waiting send of this chat (only the one named, so an old click can't cancel a newer send). */
export function cancelHold(chatId: string, callId: string): boolean {
  const h = holds.get(`${chatId}|${callId}`);
  if (!h) return false;
  h.cancel();
  return true;
}
