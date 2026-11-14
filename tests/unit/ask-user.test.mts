import { test } from "node:test";
import assert from "node:assert/strict";
import { answersText, cleanAnswers, cleanQuestions } from "../../lib/ask-user.ts";

test("questions are checked: 1-4, each with 2-3 options", () => {
  const ok = cleanQuestions({ intro: " Avant d'exporter : ", questions: [{ question: "Les numéros non vérifiés ?", options: ["Les garder avec une colonne Vérification", "Les retirer", "Les retirer", "x", "y"] }] });
  assert.ok(typeof ok !== "string");
  assert.equal(ok.intro, "Avant d'exporter :");
  assert.deepEqual(ok.items[0]!.options, ["Les garder avec une colonne Vérification", "Les retirer", "x"]);
  assert.match(cleanQuestions({ questions: [] }) as string, /1-4 questions/);
  assert.match(cleanQuestions({ questions: [{ question: "A?", options: ["only one"] }] }) as string, /needs 2 or 3 options/);
  assert.match(cleanQuestions({ questions: Array.from({ length: 5 }, () => ({ question: "Q", options: ["a", "b"] })) }) as string, /at most 4/);
  // Sent as JSON text by some models.
  assert.ok(typeof cleanQuestions({ questions: JSON.stringify([{ question: "Q?", options: ["a", "b"] }]) }) !== "string");
});

test("answers: one per question, picked or written; skipped lets the bot decide", () => {
  const items = [{ question: "Format?", options: ["Excel", "CSV"] }, { question: "Columns first?", options: ["Statut, Note", "None"] }];
  assert.equal(cleanAnswers(items, ["Excel"]), null);
  assert.equal(cleanAnswers(items, ["Excel", "  "]), null);
  assert.deepEqual(cleanAnswers(items, ["Excel", "Statut et Note vides, puis le nom"]), ["Excel", "Statut et Note vides, puis le nom"]);
  const text = answersText(items, ["Excel", "Statut et Note vides, puis le nom"]);
  assert.match(text, /1\. Format\? → Excel\n2\. Columns first\? → Statut et Note vides, puis le nom \(written by the user\)/);
  assert.match(answersText(items, null), /skipped.*sensible choices/);
});
