import { test } from "node:test";
import assert from "node:assert/strict";
import { doneCheckInput, parseVerdict, sameMissing } from "../../lib/done-check-core.ts";

test("the check's answer is read strictly; anything unclear continues nothing", () => {
  assert.deepEqual(parseVerdict('Sure: {"status":"unfinished","missing":"22 factories still to find","goal":"50 factories in Akbou"}'), { status: "unfinished", missing: "22 factories still to find", goal: "50 factories in Akbou" });
  assert.equal(parseVerdict('{"status":"done","missing":"","goal":"x"}')?.status, "done");
  assert.equal(parseVerdict('{"status":"needs_user","missing":"the user must sign in","goal":""}')?.status, "needs_user");
  assert.equal(parseVerdict('{"status":"unfinished","missing":""}'), null); // nothing to act on
  assert.equal(parseVerdict('{"status":"maybe"}'), null);
  assert.equal(parseVerdict("not json"), null);
});

test("the input holds the request, the goal, what was done and the reply, and stays short", () => {
  const s = doneCheckInput({ request: "اجمعلي قائمة من خمسين مصنع في اقبو", goal: "50 factories", activity: "research ×1, work_table ×1", reply: "21 lignes. Je peux relancer.".repeat(500) });
  assert.match(s, /^The user's request:\nاجمعلي/);
  assert.match(s, /The goal set for this work: 50 factories/);
  assert.ok(s.length < 9000, String(s.length));
});

test("a 'still missing' note that repeats means the rounds stopped moving", () => {
  assert.ok(sameMissing("22 factories still to find in Akbou", "Still 22 factories to find in Akbou"));
  assert.ok(!sameMissing("22 factories still to find", "Send the message and like the latest post"));
  assert.ok(!sameMissing(undefined, "x"));
});

test("a reply that says the same as the previous one is recognized, even reworded", async () => {
  const { sameReply } = await import("../../lib/done-check-core.ts");
  const a = "The message was not sent to Tigrine Marys. The Messenger box shows garbled characters, so I won't send. Type it yourself, or I send it in English.";
  const b = "The message wasn't sent to Tigrine Marys. The Messenger box still shows garbled characters, so I won't send. Type it yourself, or I send it in English instead.";
  assert.ok(sameReply(a, b));
  assert.ok(!sameReply(a, "Both are done: the message is sent and the latest post is liked."));
});

test("the check is told that a real choice after failed attempts belongs to the user", async () => {
  const { DONE_CHECK_SYSTEM } = await import("../../lib/done-check-core.ts");
  assert.match(DONE_CHECK_SYSTEM, /offers the user a real choice between different ways forward/);
});
