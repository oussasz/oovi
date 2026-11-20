// Waiting for the user to connect an app's account. oovi opens the connection page and then looks at the
// app's connections until they change: the bot hears "connected" from the service, not from a guess.
// Pure (the reading and the clock are passed in): tests/unit/connect-core.test.mts.

export type WaitResult = { changed: true; now: string } | { changed: false; reason: "timeout" | "stopped" };

/**
 * Reads the connection state every `everyMs` until it differs from `before`. A read that fails (null) is not
 * a change. Ends at `maxMs`, or when the user presses Stop.
 */
export async function waitForChange(
  read: () => Promise<string | null>,
  o: { before: string; everyMs: number; maxMs: number; sleep: (ms: number) => Promise<void>; now: () => number; signal?: AbortSignal },
): Promise<WaitResult> {
  const start = o.now();
  const same = (a: string) => a.replace(/\s+/g, " ").trim() === o.before.replace(/\s+/g, " ").trim();
  for (;;) {
    if (o.signal?.aborted) return { changed: false, reason: "stopped" };
    const got = await read().catch(() => null);
    if (o.signal?.aborted) return { changed: false, reason: "stopped" };
    if (got !== null && !same(got)) return { changed: true, now: got };
    if (o.now() - start >= o.maxMs) return { changed: false, reason: "timeout" };
    await o.sleep(o.everyMs);
  }
}
