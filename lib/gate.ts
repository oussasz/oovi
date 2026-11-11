// A gate that lets at most N things run at once; the rest wait in line, first come first served.
// Used for calls to theOovi: its server allows a few calls at a time per account, so when several
// bots work at the same time their calls queue here for a moment instead of failing as "busy".
// Pure (no imports): tests/unit/gate.test.mts.

export type Gate = { run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>; readonly running: number; readonly waiting: number };

/** limit is read each time a slot frees up, so a new server limit applies without a restart. */
export function createGate(limit: () => number): Gate {
  let running = 0;
  const line: { start: () => void; cancel: () => void; signal?: AbortSignal }[] = [];
  const max = () => Math.max(1, Math.floor(limit()) || 1);
  const next = () => {
    while (running < max() && line.length) line.shift()!.start();
  };
  return {
    get running() {
      return running;
    },
    get waiting() {
      return line.length;
    },
    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const aborted = () => Object.assign(new Error("Stopped."), { name: "AbortError" });
      if (signal?.aborted) throw aborted();
      if (running >= max() || line.length) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            const i = line.indexOf(item);
            if (i >= 0) line.splice(i, 1);
            reject(aborted());
          };
          const item = {
            start: () => {
              signal?.removeEventListener("abort", onAbort);
              running++; // the slot is taken the moment it's handed over
              resolve();
            },
            cancel: onAbort,
            signal,
          };
          line.push(item);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      } else running++;
      try {
        return await fn();
      } finally {
        running--;
        next();
      }
    },
  };
}
