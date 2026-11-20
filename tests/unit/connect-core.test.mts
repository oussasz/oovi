// Waiting for the user to connect an app (lib/connect-core.ts): oovi looks at the app's connections until
// they change, so the bot goes on by itself. The bot used to give a link and guess whether it had been used.
import test from "node:test";
import assert from "node:assert/strict";
import { waitForChange } from "../../lib/connect-core.ts";

const noSleep = async () => {};

test("it ends as soon as what the service says about the connection changes", async () => {
  const answers = ["[]", "[]", "[]", '[{"id":"conn_1"}]'];
  let n = 0;
  const r = await waitForChange(async () => answers[Math.min(n++, answers.length - 1)]!, { before: "[]", everyMs: 1, maxMs: 1000, sleep: noSleep, now: () => n });
  assert.deepEqual(r, { changed: true, now: '[{"id":"conn_1"}]' });
  assert.equal(n, 4);
});

test("it gives up after the time allowed, and says so", async () => {
  let t = 0;
  const r = await waitForChange(async () => "[]", { before: "[]", everyMs: 10, maxMs: 50, sleep: async (ms) => void (t += ms), now: () => t });
  assert.equal(r.changed, false);
  assert.equal(r.reason, "timeout");
});

test("Stop ends the wait", async () => {
  const ac = new AbortController();
  let n = 0;
  const r = await waitForChange(async () => (++n === 2 && ac.abort(), "[]"), { before: "[]", everyMs: 1, maxMs: 1000, sleep: noSleep, now: () => n, signal: ac.signal });
  assert.equal(r.changed, false);
  assert.equal(r.reason, "stopped");
});

test("a read that fails is not a change: the wait goes on", async () => {
  const answers: (string | null)[] = [null, null, "[1]"];
  let n = 0;
  const r = await waitForChange(async () => answers[Math.min(n++, 2)]!, { before: "[]", everyMs: 1, maxMs: 1000, sleep: noSleep, now: () => n });
  assert.equal(r.changed, true);
  assert.equal(n, 3);
});
