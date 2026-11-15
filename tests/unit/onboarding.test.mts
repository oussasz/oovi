import { test } from "node:test";
import assert from "node:assert/strict";
import { GOALS, LEADERS, leaderNotes, suggestSetups } from "../../lib/onboarding-core.ts";

const ALL = [...new Set(GOALS.flatMap((g) => g.setups.filter((id) => id !== "starter")))].map((id) => ({ id, name: id.replace(/-/g, " "), description: `${id} helper` }));

test("each goal suggests setups that fit it, only the best one ticked (a calm first day)", () => {
  const s = suggestSetups(["marketing"], "", ALL);
  assert.equal(s.ids[0], "marketing-agency");
  assert.equal(s.ids.length, 4);
  assert.deepEqual(s.picked, s.ids.slice(0, 1));
  // Two goals: what both need rises; at most 4 cards.
  const two = suggestSetups(["shop", "marketing"], "", ALL);
  assert.ok(two.ids.includes("shop-team") && two.ids.includes("marketing-agency"));
  assert.ok(two.ids.indexOf("social-manager") < 3, two.ids.join(","));
});

test("everyday help offers the classic starter team; nothing chosen gets a sensible default", () => {
  assert.deepEqual(suggestSetups(["everyday"], "", ALL).ids, ["starter"]);
  const none = suggestSetups([], "", ALL);
  assert.equal(none.ids[0], "starter");
  assert.deepEqual(none.picked, ["starter"]);
});

test("words typed under 'something else' find matching setups", () => {
  const s = suggestSetups([], "I need a website for my restaurant", ALL);
  assert.ok(s.ids.includes("web-agency"), s.ids.join(","));
});

test("setups the Marketplace hides are never suggested", () => {
  const s = suggestSetups(["marketing"], "", ALL.filter((x) => x.id !== "marketing-agency"));
  assert.ok(!s.ids.includes("marketing-agency"));
});

test("the leader's notes carry its character and the user's goals", () => {
  const n = leaderNotes("funny", ["clients", "nope"], "  a café   in Oran ");
  assert.match(n, /Your personality: funny and playful/);
  assert.match(n, /finding clients and sales, "a café in Oran"/);
  assert.equal(leaderNotes(null, [], ""), "");
  assert.equal(new Set(LEADERS.map((l) => l.name)).size, LEADERS.length);
});

import { ideasFor } from "../../lib/onboarding-core.ts";
test("ideas stay open: at most two from the first goals, the rest general", () => {
  assert.deepEqual(ideasFor(["clients"], 3), ["home.idea.g.clients", "home.idea.post", "home.idea.slides"]);
  const many = ideasFor(["clients", "shop", "study", "code"], 4);
  assert.equal(many.filter((k) => k.startsWith("home.idea.g.")).length, 2);
  assert.deepEqual(ideasFor([], 4), ["home.idea.post", "home.idea.slides", "home.idea.budget", "home.idea.digest"]);
});

test("the Chief knows the first interests are only a start, not a limit", () => {
  assert.match(leaderNotes("calm", ["study"], ""), /only where they started, not a limit[\s\S]*follow what they ask now/);
});
