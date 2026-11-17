import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlocks, progress, toggleBox } from "../../lib/page-blocks.ts";

const PLAN = "# Launch plan\n\n## Steps\n- [x] Finish the page\n- [ ] Record the video\n  with a good microphone\n1. first\n2. second\n\n| Week | Focus |\n|---|---|\n| 1 | Page |\n\n> note\n\n```\ncode | not a table\n```\n---\nplain **text**";

test("a page is split into headings, lists, tables, quotes, code and text", () => {
  const b = parseBlocks(PLAN);
  assert.deepEqual(b.map((x) => x.kind), ["h", "h", "list", "list", "table", "quote", "code", "hr", "p"]);
  const steps = b[2] as Extract<(typeof b)[number], { kind: "list" }>;
  assert.deepEqual(steps.items.map((i) => [i.done, i.text]), [[true, "Finish the page"], [false, "Record the video with a good microphone"]]);
  assert.equal((b[3] as typeof steps).ordered, true);
  const t = b[4] as Extract<(typeof b)[number], { kind: "table" }>;
  assert.deepEqual([t.head, t.rows], [["Week", "Focus"], [["1", "Page"]]]);
});

test("ticking a step rewrites only that line; progress counts the boxes", () => {
  assert.deepEqual(progress(PLAN), { done: 1, total: 2 });
  const line = PLAN.split("\n").findIndex((l) => l.includes("Record the video"));
  const next = toggleBox(PLAN, line);
  assert.deepEqual(progress(next), { done: 2, total: 2 });
  assert.equal(next.split("\n").filter((l, i) => l !== PLAN.split("\n")[i]).length, 1);
  assert.equal(toggleBox(PLAN, 0), PLAN, "a line without a box is left alone");
  assert.equal(progress("no boxes here"), null);
});

test("Arabic and odd input don't break it", () => {
  assert.equal(parseBlocks("## خطة\n- [ ] الخطوة الأولى").length, 2);
  assert.deepEqual(parseBlocks(""), []);
  assert.equal(parseBlocks("| only one line |").at(0)?.kind, "p");
});
