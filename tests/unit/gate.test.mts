import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../../lib/gate.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("never more than the limit at once, and everything finishes in order", async () => {
  const gate = createGate(() => 3);
  let now = 0;
  let peak = 0;
  const order: number[] = [];
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      gate.run(async () => {
        now++;
        peak = Math.max(peak, now);
        order.push(i);
        await sleep(10);
        now--;
      }),
    ),
  );
  assert.equal(peak, 3);
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // first come, first served
  assert.equal(gate.running, 0);
  assert.equal(gate.waiting, 0);
});

test("a failed call frees its place", async () => {
  const gate = createGate(() => 1);
  await assert.rejects(gate.run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await gate.run(async () => "ok"), "ok");
  assert.equal(gate.running, 0);
});

test("Stop while waiting in line leaves the line, and doesn't take a place", async () => {
  const gate = createGate(() => 1);
  const ac = new AbortController();
  const first = gate.run(() => sleep(30));
  let ran = false;
  const second = gate.run(async () => { ran = true; }, ac.signal);
  const third = gate.run(async () => "third");
  ac.abort();
  await assert.rejects(second, { name: "AbortError" });
  await first;
  assert.equal(await third, "third");
  assert.equal(ran, false);
  assert.equal(gate.running, 0);
  await assert.rejects(gate.run(async () => 1, ac.signal), { name: "AbortError" }); // already stopped: never starts
});

test("a limit that changes applies to the next ones; nonsense limits mean one at a time", async () => {
  let limit = 1;
  const gate = createGate(() => limit);
  let now = 0;
  let peak = 0;
  const job = () => gate.run(async () => { now++; peak = Math.max(peak, now); await sleep(10); now--; });
  const a = job();
  limit = 2;
  await Promise.all([a, job(), job(), job()]);
  assert.equal(peak, 2);
  limit = Number.NaN;
  peak = 0;
  await Promise.all([job(), job()]);
  assert.equal(peak, 1);
});
