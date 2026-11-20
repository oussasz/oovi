// Loop guard: a bot that makes the same tool call over and over, or repeats a call that failed the same way
// twice, is stopped before the call runs and told to try another way. Pure (types only):
// tests/unit/loop-guard.test.mts.
import type { Msg, ToolCall } from "./types";

/** Calls that are normal to repeat with the same input: scrolling, going back, waiting for a page or a screen. */
export const REPEATABLE = new Set(["scroll", "go_back", "read_page", "send_screenshot", "list_windows", "wait_until"]);
/** The same call this many times in a row (this turn) is refused. */
export const MAX_SAME = 4;
/** A call that failed this many times in a row with the same input is refused. */
export const MAX_SAME_FAIL = 2;

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

/** A call's identity: its tool and its input, whatever the key order. */
export const callKey = (c: Pick<ToolCall, "name" | "input">): string => `${c.name} ${stable(c.input)}`;

type Done = { key: string; failed: boolean };

/** The calls already made in these steps, oldest first, with whether each failed. */
export function callsSoFar(steps: Msg[]): Done[] {
  const out: Done[] = [];
  steps.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const next = steps[i + 1];
    for (const c of m.toolCalls) {
      const r = next?.role === "tool" ? next.results.find((x) => x.id === c.id) : undefined;
      if (r) out.push({ key: callKey(c), failed: !!r.isError });
    }
  });
  return out;
}

/** null when the call may run; otherwise the reason to give the bot instead of running it. */
export function loopRefusal(done: Done[], c: Pick<ToolCall, "name" | "input">, repeatable: (name: string) => boolean = (n) => REPEATABLE.has(n)): string | null {
  if (repeatable(c.name)) return null;
  const key = callKey(c);
  let same = 0;
  let sameFail = 0;
  for (let i = done.length - 1; i >= 0 && done[i]!.key === key; i--) {
    same++;
    if (done[i]!.failed && sameFail === same - 1) sameFail++;
  }
  if (sameFail >= MAX_SAME_FAIL) {
    return `Not run: this exact ${c.name} call already failed ${sameFail} times in a row, and it would fail the same way again. Change something (another input, another tool, another site or route), or if nothing else can work, tell the user plainly what is blocking you and what they can do.`;
  }
  if (same >= MAX_SAME) {
    return `Not run: you already made this exact ${c.name} call ${same} times in a row. Repeating it won't change the result: use what you already got, or try a different input or another way.`;
  }
  return null;
}

/** Tools that make a whole file in one call. */
const MAKERS: ReadonlySet<string> = new Set(["create_presentation", "create_spreadsheet", "create_image", "create_document"]);
/** How many times one file may be made in one turn: once, and once more to correct it. */
export const MAX_REMAKES = 2;

/**
 * A file made a third time in the same turn, with nothing new from the user in between, is refused. Measured
 * on the real model (2026-11-20): a five-slide deck was made four times in a row, each a full rewrite, and
 * the request cost 17 credits instead of 4; every result had said "Created". The calls differ a little each
 * time, so the same-call guard above never sees them.
 */
export function remadeRefusal(steps: Msg[], c: Pick<ToolCall, "name" | "input">): string | null {
  if (!MAKERS.has(c.name) || c.input.append === true) return null;
  const file = String(c.input.filename ?? "").trim().toLowerCase();
  if (!file) return null;
  let made = 0;
  steps.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const next = steps[i + 1];
    for (const x of m.toolCalls) {
      if (x.name !== c.name || x.input.append === true || String(x.input.filename ?? "").trim().toLowerCase() !== file) continue;
      const r = next?.role === "tool" ? next.results.find((y) => y.id === x.id) : undefined;
      if (r && !r.isError) made++;
    }
  });
  if (made < MAX_REMAKES) return null;
  return `Not run: you already made "${String(c.input.filename)}" ${made} times in this turn, and the user has it. It is done: tell them the result now. Make it again only if they ask for a change.`;
}
