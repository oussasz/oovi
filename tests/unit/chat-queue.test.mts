// A message typed while the bot works is shown as "queued" until the chat holds it. Reported on Windows: it stayed
// "queued" after it was sent. When the bot was on its last step, the message started the next run with no window
// listening, so the event that cleared the label was never seen (lib/chat-queue-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { pruneQueued } from "../../lib/chat-queue-core.ts";

test("a queued message the saved chat already holds is no longer shown as queued", () => {
  const q = [{ id: "m1", text: "and add Oran" }, { id: "m2", text: "thanks" }];
  const entries = [{ id: "u0", kind: "user" }, { id: "b0", kind: "bot" }, { id: "m1", kind: "user" }];
  assert.deepEqual(pruneQueued(q, entries), [{ id: "m2", text: "thanks" }]);
});

test("nothing changes when none of them is in the chat yet (same list, so no redraw)", () => {
  const q = [{ id: "m1", text: "x" }];
  assert.equal(pruneQueued(q, [{ id: "u0", kind: "user" }]), q);
  const empty: { id: string; text: string }[] = [];
  assert.equal(pruneQueued(empty, [{ id: "m1", kind: "user" }]), empty);
});
