// One action per row, run by the app (lib/batch-core.ts): each row once, even after a stop and a second run;
// a run that keeps failing stops instead of burning through the list; what may have run is never run again.
import test from "node:test";
import assert from "node:assert/strict";
import { runBatch, batchKey, batchSummary } from "../../lib/batch-core.ts";

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 2, input: { to: `a${i}@x.dz` } }));
const key = (i: { input: unknown }) => batchKey("send", i.input);

test("every row's action runs once and is recorded as done", async () => {
  const ran: number[] = [];
  const ledger = new Map<string, string>();
  const r = await runBatch(items(4), { keyOf: key, done: new Set(), run: async (i) => (ran.push(i.n), { ok: true, text: "sent" }), record: (k, o) => ledger.set(k, o) });
  assert.deepEqual(ran, [2, 3, 4, 5]);
  assert.equal(r.done, 4);
  assert.equal(ledger.size, 4);
  assert.ok([...ledger.values()].every((v) => v === "done"));
  assert.equal(r.stopped, undefined);
});

test("a second run skips what the first one did", async () => {
  const all = items(4);
  const done = new Set([key(all[0]!), key(all[1]!)]);
  const ran: number[] = [];
  const r = await runBatch(all, { keyOf: key, done, run: async (i) => (ran.push(i.n), { ok: true, text: "" }), record: () => {} });
  assert.deepEqual(ran, [4, 5]);
  assert.equal(r.already, 2);
  assert.equal(r.done, 2);
});

test("the same input has the same key whatever the order of its fields", () => {
  assert.equal(batchKey("t", { a: 1, b: { c: 2, d: 3 } }), batchKey("t", { b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(batchKey("t", { a: 1 }), batchKey("u", { a: 1 }));
});

test("failures in a row stop the batch; the rest is left for later, not run", async () => {
  const ran: number[] = [];
  const r = await runBatch(items(20), { keyOf: key, done: new Set(), maxFailStreak: 3, run: async (i) => (ran.push(i.n), i.n < 5 ? { ok: true, text: "" } : { ok: false, text: "Daily sending limit reached" }), record: () => {} });
  assert.deepEqual(ran, [2, 3, 4, 5, 6, 7]);
  assert.equal(r.done, 3);
  assert.equal(r.failed.length, 3);
  assert.equal(r.notRun, 14);
  assert.equal(r.stopped, "failures");
  assert.match(r.failed[0]!.reason, /Daily sending limit/);
});

test("a failure here and there doesn't stop the batch", async () => {
  const r = await runBatch(items(9), { keyOf: key, done: new Set(), maxFailStreak: 3, run: async (i) => (i.n % 3 === 0 ? { ok: false, text: "bad address" } : { ok: true, text: "" }), record: () => {} });
  assert.equal(r.done, 6);
  assert.equal(r.failed.length, 3);
  assert.equal(r.stopped, undefined);
});

test("an action that got no answer may have run: it is recorded, and never run again", async () => {
  const ledger = new Map<string, string>();
  const all = items(3);
  const r = await runBatch(all, { keyOf: key, done: new Set(), run: async (i) => (i.n === 3 ? { ok: false, text: "no answer in time", maybeRan: true } : { ok: true, text: "" }), record: (k, o) => ledger.set(k, o) });
  assert.deepEqual(r.unknown, [3]);
  assert.equal(ledger.get(key(all[1]!)), "unknown");
  const ran: number[] = [];
  await runBatch(all, { keyOf: key, done: new Set(ledger.keys()), run: async (i) => (ran.push(i.n), { ok: true, text: "" }), record: () => {} });
  assert.deepEqual(ran, []);
});

test("Stop ends the batch between two rows", async () => {
  const ac = new AbortController();
  const ran: number[] = [];
  const r = await runBatch(items(10), { keyOf: key, done: new Set(), signal: ac.signal, run: async (i) => (ran.push(i.n), i.n === 4 && ac.abort(), { ok: true, text: "" }), record: () => {} });
  assert.deepEqual(ran, [2, 3, 4]);
  assert.equal(r.stopped, "aborted");
  assert.equal(r.notRun, 7);
});

test("progress is reported as the rows go", async () => {
  const seen: string[] = [];
  await runBatch(items(3), { keyOf: key, done: new Set(), run: async () => ({ ok: true, text: "" }), record: () => {}, onProgress: (d, t) => seen.push(`${d}/${t}`) });
  assert.deepEqual(seen, ["1/3", "2/3", "3/3"]);
});

test("the summary tells the bot exactly what happened, with the rows that failed", () => {
  const s = batchSummary({ done: 500, already: 0, failed: [{ n: 502, reason: "Daily sending limit reached" }, { n: 503, reason: "Daily sending limit reached" }], unknown: [41], notRun: 420, stopped: "failures" }, { total: 923, skippedEmpty: 77, skippedDuplicate: 0, source: "Leads.xlsx" });
  assert.match(s, /500 of 923 done/);
  assert.match(s, /stopped/i);
  assert.match(s, /420 rows were not run/);
  assert.match(s, /row 502: Daily sending limit reached/);
  assert.match(s, /77 rows skipped/);
  assert.match(s, /row 41/);
  assert.match(s, /same call again/);
});
