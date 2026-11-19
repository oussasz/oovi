// Each user message tells the bot when it was sent, so short-lived things (a reminder "in 10 minutes",
// the oven) are seen as over hours later (owner's chat: the bot asked about the oven in every reply all day).
import test from "node:test";
import assert from "node:assert/strict";
import { gapWords, timeNote } from "../../lib/time-note-core.ts";

const at = Date.UTC(2026, 10, 18, 21, 39); // Wed 18 Nov 2026, 22:39 in Algiers (UTC+1)

test("the local time of the message", () => {
  assert.equal(timeNote(at, undefined, "Africa/Algiers"), "[oovi: sent Wed, 18/11/2026, 22:39]");
});

test("a long silence before it is said, a quick reply is not", () => {
  assert.match(timeNote(at, at - 11 * 3600_000 - 53 * 60_000, "Africa/Algiers"), /, 11 hours after the previous message\]$/);
  assert.doesNotMatch(timeNote(at, at - 5 * 60_000, "Africa/Algiers"), /after the previous/);
  assert.match(timeNote(at, at - 30 * 60_000, "Africa/Algiers"), /30 minutes after/);
});

test("gaps in plain words", () => {
  assert.equal(gapWords(45 * 60_000), "45 minutes");
  assert.equal(gapWords(90 * 60_000), "1 hour");
  assert.equal(gapWords(3 * 24 * 3600_000 + 5), "3 days");
});

test("an unknown time zone still gives a time, never an error", () => {
  assert.match(timeNote(at, undefined, "Not/AZone"), /^\[oovi: sent 2026-11-18 21:39 UTC\]$/);
});

test("the same message always gives the same note (the prompt cache depends on it)", () => {
  assert.equal(timeNote(at, at - 7200_000, "Africa/Algiers"), timeNote(at, at - 7200_000, "Africa/Algiers"));
});
