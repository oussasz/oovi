// Pure helpers for Admin > Problems (lib/problems.ts): tests/unit/problem-key.test.mts.
import { createHash } from "node:crypto";

export const PROBLEM_TAGS = ["tool", "failed", "unmet"] as const;
export type ProblemTag = (typeof PROBLEM_TAGS)[number];
export const PROBLEM_TAG_LABELS: Record<ProblemTag, string> = { tool: "Tool error", failed: "Task stopped", unmet: "Couldn't do it" };

/** The same problem in other words of the same shape: lower case, numbers and punctuation ignored. */
export function problemKey(message: string): string {
  const norm = message
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#\[\]]+/gu, " ")
    .trim()
    .slice(0, 140);
  return createHash("md5").update(norm).digest("hex");
}

/** A version like 0.10.14 (what the owner types in "Fixed in"). */
export const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

/** Whether a report from this version, now, means the problem came back after its fix. */
export function cameBack(fix: { fixedIn: string } | null, version: string | null): boolean {
  return !!fix && !!version && /^\d/.test(version) && atLeast(version, fix.fixedIn);
}

/** a >= b for versions like 0.10.14 (as compareVersions in versions.ts; no import, so tests run it as is). */
function atLeast(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
}

