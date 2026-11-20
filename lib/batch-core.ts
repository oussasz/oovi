// One action per row, run by the app instead of by a model. "Send an email to everyone in the list" used to
// mean one model call per email (a thousand calls, each carrying the whole conversation), which never fit a
// turn. Here the bot says what to do for one row once; the app does it for every row, keeps a ledger so a
// row is never done twice (a stop, a daily limit, a second run), and stops when the service keeps refusing.
// Pure: tests/unit/batch-core.test.mts.

export type BatchItem = { /** The row's number in its table. */ n: number; input: unknown };
export type Outcome = "done" | "unknown";
export type OneResult = { ok: boolean; text: string; /** No answer came back: the action may have run. */ maybeRan?: boolean };
export type BatchResult = {
  done: number;
  /** Done in an earlier run: skipped now. */
  already: number;
  failed: { n: number; reason: string }[];
  /** Rows whose action got no answer: they may have run, and are not run again. */
  unknown: number[];
  /** Rows left when the batch stopped. */
  notRun: number;
  stopped?: "aborted" | "failures";
};

const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

/** Identifies one action (a tool and its exact input), whatever the order of the input's fields. A short hash: the ledger holds no addresses. */
export function batchKey(tool: string, input: unknown): string {
  const s = `${tool}\n${stable(input)}`;
  // FNV-1a, twice with different seeds: 64 bits is plenty to tell a few thousand rows apart.
  const h = (seed: number) => {
    let x = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619) >>> 0;
    }
    return x.toString(16).padStart(8, "0");
  };
  return h(2166136261) + h(3339675911);
}

/** This many failures in a row mean the service refuses (a daily limit, a lost sign-in): go on later instead. */
export const MAX_FAIL_STREAK = 5;

export async function runBatch<T extends BatchItem>(
  items: T[],
  o: {
    keyOf: (item: T) => string;
    done: ReadonlySet<string>;
    run: (item: T) => Promise<OneResult>;
    record: (key: string, outcome: Outcome) => void;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    maxFailStreak?: number;
  },
): Promise<BatchResult> {
  const max = o.maxFailStreak ?? MAX_FAIL_STREAK;
  const todo = items.filter((i) => !o.done.has(o.keyOf(i)));
  const r: BatchResult = { done: 0, already: items.length - todo.length, failed: [], unknown: [], notRun: 0 };
  let streak = 0;
  for (let k = 0; k < todo.length; k++) {
    if (o.signal?.aborted) {
      r.stopped = "aborted";
      r.notRun = todo.length - k;
      return r;
    }
    const item = todo[k]!;
    let one: OneResult;
    try {
      one = await o.run(item);
    } catch (e) {
      one = { ok: false, text: (e as Error).message || String(e) };
    }
    if (one.ok) {
      o.record(o.keyOf(item), "done");
      r.done++;
      streak = 0;
    } else if (one.maybeRan) {
      // Never again: a second email is worse than a missing one, and the user is told which rows to check.
      o.record(o.keyOf(item), "unknown");
      r.unknown.push(item.n);
      streak++;
    } else {
      r.failed.push({ n: item.n, reason: one.text.replace(/\s+/g, " ").trim().slice(0, 200) });
      streak++;
    }
    o.onProgress?.(r.done, todo.length);
    if (streak >= max) {
      r.stopped = "failures";
      r.notRun = todo.length - k - 1;
      return r;
    }
  }
  return r;
}

/** What the bot is told when the batch ends: the numbers, why it stopped, the rows to look at, how to go on. */
export function batchSummary(r: BatchResult, o: { total: number; skippedEmpty: number; skippedDuplicate: number; source: string }): string {
  const lines = [`${r.done + r.already} of ${o.total} done${r.already ? ` (${r.already} of them in an earlier run, not repeated)` : ""}, from "${o.source}".`];
  if (r.stopped === "failures") lines.push(`Stopped: the last ${Math.min(r.failed.length + r.unknown.length, MAX_FAIL_STREAK)} actions in a row failed, so the service is refusing for now (often a daily limit or a sign-in). ${r.notRun} rows were not run.`);
  if (r.stopped === "aborted") lines.push(`Stopped by the user. ${r.notRun} rows were not run.`);
  if (r.failed.length) lines.push(`${r.failed.length} failed: ${r.failed.slice(0, 8).map((f) => `row ${f.n}: ${f.reason}`).join("; ")}${r.failed.length > 8 ? `; and ${r.failed.length - 8} more` : ""}.`);
  if (r.unknown.length) lines.push(`${r.unknown.length} got no answer and may or may not have gone through (they are not run again): row ${r.unknown.slice(0, 20).join(", row ")}.`);
  const skipped = [o.skippedEmpty ? `${o.skippedEmpty} rows skipped because a value the action needs is empty` : "", o.skippedDuplicate ? `${o.skippedDuplicate} repeats skipped` : ""].filter(Boolean);
  if (skipped.length) lines.push(`${skipped.join("; ")}.`);
  if (r.stopped || r.failed.length) lines.push("To go on later, make the same call again: rows already done are skipped, only the rest runs.");
  lines.push("The user approved this batch on its card (with your note, if you wrote one). Report the result in a few lines, with these numbers as they are. Don't go back over who was included or how it was worded: that was their decision on the card.");
  return lines.join("\n");
}
