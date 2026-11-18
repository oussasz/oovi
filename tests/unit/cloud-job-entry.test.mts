// A phone's message keeps one id wherever it runs: the desktop (lib/cloud-sync-core.ts) and the cloud runner
// (runner/core.mjs) give it the same, and a job run again takes its earlier message and answers out first.
import test from "node:test";
import assert from "node:assert/strict";
import { jobEntryId, withoutJobEntry } from "../../lib/cloud-sync-core.ts";
// @ts-expect-error plain JavaScript module without types
import { entryIdFor, resetForRetry } from "../../runner/core.mjs";

test("the desktop and the runner give a phone's message the same id", () => {
  for (const [id, payload] of [["0f8e2c1a-1111-4abc-9def-123456789abc", {}], ["0f8e2c1a-1111-4abc-9def-123456789abc", { entryId: "phone-77" }], ["x", { entryId: "../bad" }]] as const) {
    assert.equal(jobEntryId(id, payload), entryIdFor({ id, payload }));
  }
});

test("a job run again on the desktop replaces the cloud's answer, as the runner does", () => {
  const chat = { id: "c", entries: [{ id: "u0", kind: "user" }, { id: "jx", kind: "user" }, { id: "b1", kind: "bot" }, { id: "u2", kind: "user" }], pending: { queue: [] } };
  const here = withoutJobEntry(chat, "jx");
  assert.deepEqual(here?.entries.map((e) => e.id), ["u0", "u2"]);
  assert.deepEqual(here?.entries, resetForRetry(chat, "jx").entries);
  assert.equal(withoutJobEntry(chat, "nope"), null);
});
