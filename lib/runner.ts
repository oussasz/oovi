// Chat runs live in the server process, not in the HTTP request: you can switch
// chats or reload the page while bots keep working. Clients subscribe to a
// run's events; a stop request aborts it.

import { setDesktopStop } from "./desktop-control";
import { orchestrate, type RunInput } from "./orchestrator";
import type { ChatEvent } from "./types";

type Listener = (e: ChatEvent) => void;
type Run = { ctrl: AbortController; listeners: Set<Listener> };
type EndHook = (chatId: string) => void;

const g = globalThis as typeof globalThis & { __ooviRuns?: Map<string, Run>; __ooviRunEnd?: Set<EndHook> };
const runs = (g.__ooviRuns ??= new Map<string, Run>());
const endHooks = (g.__ooviRunEnd ??= new Set<EndHook>());

export const isRunning = (chatId: string) => runs.has(chatId);

/** Be told whenever a run ends (any chat), after it has let go of the chat. Returns an unsubscribe function. */
export function onRunEnd(fn: EndHook): () => void {
  endHooks.add(fn);
  return () => {
    endHooks.delete(fn);
  };
}

/** Starts a run. Returns false if this chat is already running. */
export function startRun(chatId: string, input: RunInput): boolean {
  if (runs.has(chatId)) return false;
  const run: Run = { ctrl: new AbortController(), listeners: new Set() };
  runs.set(chatId, run);
  const emit = (e: ChatEvent) => {
    for (const l of run.listeners) {
      try {
        l(e);
      } catch {
        /* a dead listener must not break the run */
      }
    }
  };
  void (async () => {
    try {
      for await (const ev of orchestrate(chatId, input, run.ctrl.signal)) emit(ev);
    } catch (e) {
      emit({ type: "error", error: (e as Error).message || String(e) });
    } finally {
      runs.delete(chatId);
      emit({ type: "done" });
      // After the listeners, and outside this run's stack: a hook may start another run.
      for (const h of endHooks) {
        setTimeout(() => {
          try {
            h(chatId);
          } catch (e) {
            console.error("[runner] end hook:", (e as Error).message);
          }
        }, 0);
      }
    }
  })();
  return true;
}

/** Resolves when the chat's current run has ended (at once if none), or after `ms`. True when it ended. */
export function whenIdle(chatId: string, ms = 60_000): Promise<boolean> {
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

/** Listen to a running chat. Returns an unsubscribe function, or null if nothing is running. */
export function subscribe(chatId: string, fn: Listener): (() => void) | null {
  const run = runs.get(chatId);
  if (!run) return null;
  run.listeners.add(fn);
  return () => {
    run.listeners.delete(fn);
  };
}

export function stopRun(chatId: string): void {
  runs.get(chatId)?.ctrl.abort();
}

// The desktop-control banner's Stop button stops the run that is using the mouse and keyboard.
setDesktopStop((chatId) => stopRun(chatId));

/** NDJSON stream of a chat's run events, ending with {type:"done"}. */
export function eventStream(chatId: string, req: Request): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsub: (() => void) | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        unsub?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          close();
        }
        if (e.type === "done") close();
      };
      unsub = subscribe(chatId, send);
      if (!unsub) send({ type: "done" });
      req.signal.addEventListener("abort", close);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" } });
}
