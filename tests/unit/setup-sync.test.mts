import { test } from "node:test";
import assert from "node:assert/strict";
import { baseOf, itemHash, joinMemory, mergeSetup, uniqueBotNames } from "../../lib/setup-sync-core.ts";

const bot = (name: string, role = "r") => ({ name, role });

test("hash ignores key order, sees real changes", () => {
  assert.equal(itemHash({ a: 1, b: [1, 2] }), itemHash({ b: [1, 2], a: 1 }));
  assert.notEqual(itemHash({ a: 1 }), itemHash({ a: 2 }));
});

test("only one side changed an item: that side wins, deletions included", () => {
  const base0 = { "bot:1": bot("Ava"), "bot:2": bot("Bo"), "skill:x": "s" };
  const base = baseOf(base0);
  const local = { ...base0, "bot:1": bot("Ava", "Senior") };
  const { "bot:2": _gone, ...remote } = base0;
  const m = mergeSetup(local, remote, base);
  assert.deepEqual(m["bot:1"], bot("Ava", "Senior"));
  assert.equal("bot:2" in m, false, "deleted on the other computer");
  assert.equal(m["skill:x"], "s");
});

test("both changed: an edit beats a deletion; two edits: this computer", () => {
  const base0 = { "bot:1": bot("Ava"), "bot:2": bot("Bo") };
  const base = baseOf(base0);
  const local = { "bot:1": bot("Ava", "L") };
  const remote = { "bot:1": bot("Ava", "R"), "bot:2": bot("Bo", "edited") };
  const m = mergeSetup(local, remote, base);
  assert.deepEqual(m["bot:1"], bot("Ava", "L"));
  assert.deepEqual(m["bot:2"], bot("Bo", "edited"), "edited elsewhere, deleted here: kept");
});

test("first sync of a computer: the account wins on the same item, both sides' own items are kept, memories joined", () => {
  const m = mergeSetup({ settings: { a: 1 }, "bot:9": bot("Mine"), "memory:user": "Likes tea\n§\nLives in Oran" }, { settings: { a: 2 }, "bot:1": bot("Ava"), "memory:user": "Lives in Oran\n§\nHas a bakery" }, null);
  assert.deepEqual(m.settings, { a: 2 });
  assert.ok("bot:9" in m && "bot:1" in m);
  assert.equal(m["memory:user"], "Lives in Oran\n§\nHas a bakery\n§\nLikes tea");
});

test("bot names stay unique: this computer's own bot gets a number", () => {
  const out = uniqueBotNames({ "bot:1": bot("Scout"), "bot:9": bot("scout") }, { "bot:1": bot("Scout") });
  assert.equal((out["bot:1"] as { name: string }).name, "Scout");
  assert.equal((out["bot:9"] as { name: string }).name, "scout2");
});

test("joinMemory keeps each entry once", () => {
  assert.equal(joinMemory("A\n§\nB", "b\n§\nC"), "A\n§\nB\n§\nC");
});
