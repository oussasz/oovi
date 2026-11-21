// A long skill reaches the bot whole: its opening part with a list of the rest, each part loaded when it is needed
// (lib/skill-sections-core.ts). Before, every skill put in a bot's instructions was cut at 4,000 characters with
// nothing saying more existed: 284 of the 326 library skills arrived cut off.
import test from "node:test";
import assert from "node:assert/strict";
import { PROMPT_SKILL_MAX, SECTION_MAX, skillForPrompt, skillSection, skillSections } from "../../lib/skill-sections-core.ts";

const para = (n: number, w: string) => Array.from({ length: n }, (_, i) => `${w} line ${i} ${"x".repeat(60)}`).join("\n");
const LONG = `# Cold email\n\nIntro words.\n\n## Before you write\n${para(30, "before")}\n\n## The first line\n${para(30, "first")}\n\n## Follow-ups\n${para(30, "follow")}\n\n## references/examples.md\n${para(40, "example")}`;

test("a short skill is given as it is", () => {
  const s = "# Short\n\nDo this.\n\n## Step\nThen that.";
  assert.equal(skillForPrompt("Short", s), s);
});

test("a long skill gives its opening, then says what else it holds and how to load it", () => {
  const out = skillForPrompt("Cold email", LONG);
  assert.ok(out.length <= PROMPT_SKILL_MAX + 600, `${out.length}`);
  assert.match(out, /Intro words/);
  // Nothing is cut in the middle of a line, and the bot is told the rest exists.
  assert.match(out, /This skill continues/);
  for (const t of ["The first line", "Follow-ups", "references/examples.md"]) assert.ok(out.includes(t), t);
  assert.match(out, /use_skill.*section/);
});

test("a section is found by its number or by words of its title", () => {
  const list = skillSections(LONG);
  assert.deepEqual(list.map((s) => s.title), ["Before you write", "The first line", "Follow-ups", "references/examples.md"]);
  assert.match(skillSection(LONG, "3")!.text, /follow line 0/);
  assert.match(skillSection(LONG, "first line")!.text, /first line 0/);
  assert.match(skillSection(LONG, "Examples")!.text, /example line 0/);
  assert.equal(skillSection(LONG, "nothing like this"), null);
});

test("a section that is itself very long is given in parts the bot can ask for", () => {
  const huge = `# H\n\n## Big\n${para(400, "big")}`;
  const one = skillSection(huge, "Big")!;
  assert.ok(one.text.length <= SECTION_MAX + 400, `${one.text.length}`);
  assert.match(one.text, /part 1 of \d+/i);
  const two = skillSection(huge, "Big part 2")!;
  assert.match(two.text, /big line \d+/);
  assert.notEqual(two.text, one.text);
});

// ---- The checklist survives long work ----
import { checklistText, foldNote } from "../../lib/budget-core.ts";

test("when early messages are hidden to save space, the bot's checklist stays in view", () => {
  const plan = [
    { text: "Find 30 cafés in Oran", status: "done" as const },
    { text: "Add their phone numbers", status: "doing" as const },
    { text: "Export the Excel file", status: "pending" as const },
  ];
  const text = checklistText(plan);
  assert.match(text, /1\. \[done\] Find 30 cafés/);
  assert.match(text, /2\. \[doing\] Add their phone/);
  assert.match(text, /3\. \[to do\] Export/);
  assert.equal(checklistText([]), "");
  assert.equal(checklistText(undefined), "");
  const note = foldNote(24, text);
  assert.match(note, /24 earlier messages/);
  assert.match(note, /Add their phone numbers/);
  assert.equal(foldNote(3), "[3 earlier messages of this conversation are hidden to save space. They're saved: use recall_history to look anything up.]");
});
