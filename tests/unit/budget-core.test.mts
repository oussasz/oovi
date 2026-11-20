// How big a request really is (lib/budget-core.ts). oovi counts characters; the service counts tokens, and
// Arabic text, tables and JSON take more tokens per character than English prose. Measured on 2026-11-20: a
// request oovi counted as 71,026 tokens was 100,317, over the limit where the price is five times higher.
import test from "node:test";
import assert from "node:assert/strict";
import { START_RATIO, calibrate, effectiveBudget, shortenOlderResults } from "../../lib/budget-core.ts";

test("the ratio follows what the service really counted, at once when it is higher", () => {
  assert.equal(calibrate(1.3, 71_026, 100_317), 1.41);
  assert.equal(calibrate(1.0, 50_000, 80_000), 1.6);
});

test("it comes down slowly: one small reading doesn't undo a high one", () => {
  const next = calibrate(1.5, 40_000, 40_000);
  assert.ok(next < 1.5 && next >= 1.27, String(next));
});

test("tiny requests say nothing reliable and are ignored; the ratio stays within sane bounds", () => {
  assert.equal(calibrate(1.3, 800, 3000), 1.3);
  assert.equal(calibrate(1.3, 20_000, 90_000), 2);
  assert.equal(calibrate(1.3, 20_000, 0), 1.3);
  assert.equal(calibrate(1.05, 20_000, 10_000), 1);
});

test("the budget shrinks by the ratio, so the real size stays under the service's limit", () => {
  assert.equal(effectiveBudget(80_000, 1.41), 56_737);
  assert.ok(effectiveBudget(80_000, START_RATIO) * START_RATIO <= 80_000);
  assert.equal(effectiveBudget(80_000, 0.5), 80_000);
});

test("older tool results are shortened to fit, but a tool's guide stays whole (cut, it would be asked for again and again)", () => {
  const guide = `[guide:create_image]\n${"x".repeat(900)}\n[/guide]`;
  const msgs = [
    { role: "tool" as const, results: [{ id: "1", name: "use_tool", content: guide }, { id: "2", name: "read_url", content: "y".repeat(900) }] },
    { role: "tool" as const, results: [{ id: "3", name: "read_url", content: "z".repeat(900) }] },
  ];
  const out = shortenOlderResults(msgs, 400, 1);
  assert.equal((out[0] as (typeof msgs)[0]).results[0]!.content, guide);
  assert.ok((out[0] as (typeof msgs)[0]).results[1]!.content.length < 500);
  assert.equal((out[1] as (typeof msgs)[1]).results[0]!.content.length, 900, "the latest result is never cut here");
});
