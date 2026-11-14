// ask_user: when a bot truly needs the user's choice to go on, it asks with cards instead of a wall of
// text. Each question shows 2-3 short options to tap, plus "Other" to write a different answer. The
// cards come one after another; the answers go back to the bot as the tool's result.
// Pure: tests/unit/ask-user.test.mts.
import type { ToolSpec } from "./llm";
import type { AskItem } from "./types";

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 3;

export const ASK_SPEC: ToolSpec = {
  name: "ask_user",
  description:
    "Ask the user something you need before you can go on, as tappable cards (1-4 questions, one card after another): each question has 2 or 3 short options and the user can also write their own answer. Use it only when the work truly needs the user's choice (two real ways to go, a missing detail only they know); never for what you can decide, look up or assume sensibly, and never to ask permission for what they already asked. Don't write the questions in your message as well. Put your recommended option first. Call it alone, as the last thing in your turn; the answers come back as its result.",
  parameters: {
    type: "object",
    properties: {
      intro: { type: "string", description: "Optional: one short sentence before the questions (why you ask)." },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "Short and clear, in the user's language." },
            options: { type: "array", items: { type: "string" }, description: "2 or 3 short answers (a few words each), the recommended one first." },
          },
          required: ["question", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** The questions to show, or what's wrong with them (sent back to the bot to fix). */
export function cleanQuestions(input: Record<string, unknown>): { intro: string; items: AskItem[] } | string {
  let raw = input.questions;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      /* checked below */
    }
  }
  if (!Array.isArray(raw) || !raw.length) return "questions must be a list of 1-4 questions, each with 2 or 3 options.";
  if (raw.length > MAX_QUESTIONS) return `Ask at most ${MAX_QUESTIONS} questions at a time: keep the ones you can't go on without.`;
  const items: AskItem[] = [];
  for (const [i, q] of raw.entries()) {
    const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
    const question = clean(o.question, 300);
    const options = [...new Set((Array.isArray(o.options) ? o.options : []).map((x) => clean(x, 80)).filter(Boolean))];
    if (!question) return `Question ${i + 1} has no text.`;
    if (options.length < 2) return `Question ${i + 1} ("${question.slice(0, 60)}") needs 2 or 3 options (the user can also write their own).`;
    items.push({ question, options: options.slice(0, MAX_OPTIONS) });
  }
  return { intro: clean(input.intro, 300), items };
}

/** Answers as the user sent them: one per question, each 1-1000 characters. Null when they don't fit the questions. */
export function cleanAnswers(items: AskItem[], answers: unknown): string[] | null {
  if (!Array.isArray(answers) || answers.length !== items.length) return null;
  const out = answers.map((a) => clean(a, 1000));
  return out.every(Boolean) ? out : null;
}

/** The tool result the bot gets back. */
export function answersText(items: AskItem[], answers: string[] | null): string {
  if (!answers) return "The user skipped these questions. Make sensible choices yourself, go on with the work, and say in one line which choices you made.";
  return [
    "The user answered:",
    ...items.map((q, i) => {
      const a = answers[i] ?? "";
      const picked = q.options.includes(a);
      return `${i + 1}. ${q.question} → ${a}${picked ? "" : " (written by the user)"}`;
    }),
    "Go on with the work now, following these answers.",
  ].join("\n");
}
