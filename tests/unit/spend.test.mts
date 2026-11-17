// Spending limits and the routine run cap (lib/spend-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { addSpend, dayKey, limitReached, overCap, runCap, totals, type Ledger } from "../../lib/spend-core.ts";

test("spend adds up per day and per month; old days drop off", () => {
  let l: Ledger = { days: {} };
  l = addSpend(l, "2026-11-17", 0.5, 10);
  l = addSpend(l, "2026-11-18", 0.25, 3.5);
  l = addSpend(l, "2026-11-18", 0.25, 1.5);
  l = addSpend(l, "2026-10-30", 9, 900);
  const t = totals(l, new Date(2026, 10, 18, 12));
  assert.deepEqual(t.day, { usd: 0.5, credits: 5 });
  assert.deepEqual(t.month, { usd: 1, credits: 15 });
  for (let i = 0; i < 80; i++) l = addSpend(l, dayKey(new Date(2026, 0, 1 + i)), 1, 1);
  assert.equal(Object.keys(l.days).length, 62);
  // Negative or missing amounts never lower the total.
  assert.deepEqual(addSpend({ days: {} }, "d", -5, Number.NaN).days.d, { usd: 0, credits: 0 });
});

test("a limit is reached at or past it; no limits, nothing reached", () => {
  const l = addSpend({ days: {} }, dayKey(new Date()), 2, 50);
  assert.equal(limitReached(l, undefined, new Date()), null);
  assert.equal(limitReached(l, { dayUsd: 3 }, new Date()), null);
  assert.deepEqual(limitReached(l, { dayUsd: 2 }, new Date()), { which: "dayUsd", limit: 2, spent: 2 });
  assert.equal(limitReached(l, { monthCredits: 40 }, new Date())?.which, "monthCredits");
  assert.equal(limitReached(l, { dayCredits: 0 }, new Date()), null, "0 means no limit");
});

test("a routine run past 3 times its usual cost is over its cap; too little history, no cap", () => {
  assert.equal(runCap([{ usd: 0, credits: 2 }, { usd: 0, credits: 2 }]), null);
  const cap = runCap([{ usd: 0, credits: 2 }, { usd: 0, credits: 3 }, { usd: 0, credits: 2 }, { usd: 0, credits: 40 }]);
  assert.deepEqual(cap, { usd: 0, credits: 7.5 });
  assert.equal(overCap({ usd: 0, credits: 7 }, cap), false);
  assert.equal(overCap({ usd: 0, credits: 8 }, cap), true);
  assert.equal(runCap([{ usd: 0, credits: 0 }, { usd: 0, credits: 0 }, { usd: 0, credits: 0 }]), null);
});
