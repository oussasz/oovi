// How big a request really is. oovi sizes a request by its characters (lib/context.ts estimateTokens: three
// characters a token). The service counts tokens, and Arabic text, tables and JSON take more tokens per
// character than English prose: measured on 2026-11-20, a request counted here as 71,026 tokens was 100,317
// for the service. That is over theOovi's limit, where every token of the request costs five times more, so
// four calls of one conversation cost 6 to 13 credits each. The fix is to measure: every answer says how many
// tokens the request really was, and the next request's budget is shrunk by that ratio.
// Pure: tests/unit/budget-core.test.mts.
import type { Msg } from "./types";

/** Before the first answer of a chat: a safe guess (English prose is near 1.1, Arabic and tables near 1.4). */
export const START_RATIO = 1.3;
const MIN_RATIO = 1;
const MAX_RATIO = 2;
/** A request this small says little about the ratio (fixed overheads dominate). */
const MIN_SAMPLE = 5_000;

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The new ratio (real tokens for one counted token) after an answer. It rises at once to what was measured
 * (being under is what costs), and comes down slowly: one short English message doesn't undo a long table.
 */
export function calibrate(prev: number, estimated: number, actual: number): number {
  if (!(estimated >= MIN_SAMPLE) || !(actual > 0)) return prev;
  const seen = actual / estimated;
  return round2(Math.min(MAX_RATIO, Math.max(MIN_RATIO, seen, prev * 0.85)));
}

/** The budget in counted tokens that keeps the real size under `budget`. */
export const effectiveBudget = (budget: number, ratio: number) => Math.floor(budget / Math.max(MIN_RATIO, ratio));

const GUIDE_END = "[/guide]";
/** A result that starts with a tool's guide: the guide, and what follows it (lib/tool-defer.ts splitGuide). */
const guideOf = (content: string): [string, string] => {
  if (!content.startsWith("[guide:")) return ["", content];
  const end = content.indexOf(GUIDE_END);
  return end < 0 ? ["", content] : [content.slice(0, end + GUIDE_END.length), content.slice(end + GUIDE_END.length)];
};

/**
 * Tool results before `keepIndex` cut to `max` characters, to make a request fit. A tool's guide stays whole:
 * lib/tool-defer.ts only lets a tool be used once its whole guide is in view, so a cut guide was asked for
 * again at every step.
 */
export function shortenOlderResults(messages: Msg[], max: number, keepIndex: number, note = "older result shortened; use recall_history or run the tool again for details"): Msg[] {
  return messages.map((m, i): Msg =>
    m.role === "tool" && i !== keepIndex
      ? {
          role: "tool",
          results: m.results.map((r) => {
            const [guide, rest] = guideOf(r.content);
            return rest.length <= max ? r : { ...r, content: `${guide}${rest.slice(0, max)}\n[${note}]` };
          }),
        }
      : m,
  );
}
