// Cut answers joined back (lib/continue-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { joinCut } from "../../lib/continue-core.ts";

test("the words the second part repeats are dropped", () => {
  assert.equal(joinCut("The plan has three steps. First, we open a pickup", "we open a pickup point in Oran. Then"), "The plan has three steps. First, we open a pickup point in Oran. Then");
});

test("a cut inside a word or after a space joins without a space", () => {
  assert.equal(joinCut("Sales grew in every reg", "ion last month."), "Sales grew in every region last month.");
  assert.equal(joinCut("Sales grew in every ", "region."), "Sales grew in every region.");
  assert.equal(joinCut("Sales grew", " in every region."), "Sales grew in every region.");
  assert.equal(joinCut("السلام عليكم، هذه الخطة ", "الكاملة."), "السلام عليكم، هذه الخطة الكاملة.");
});

test("between sentences a space is added; punctuation sticks", () => {
  assert.equal(joinCut("Done.", "Next step: call them."), "Done. Next step: call them.");
  assert.equal(joinCut("We sold 12", "%."), "We sold 12%.");
});

test("a part that started over keeps only what's new", () => {
  const first = "Here is the full report on the cafés of Algiers, with phones and addresses for each one.";
  const again = `${first.slice(0, 70)}${first.slice(70)} And three more cafés in Oran.`;
  assert.equal(joinCut(first, again), `${first} And three more cafés in Oran.`);
});

test("an empty continuation changes nothing", () => {
  assert.equal(joinCut("abc", "  "), "abc");
});
