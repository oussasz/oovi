import { test } from "node:test";
import assert from "node:assert/strict";
import { abilityRequest, teamPlan, NAME_RE } from "../../lib/team-admin-core.ts";
import { NAME_RE as APP_NAME_RE } from "../../lib/mentions.ts";

// The owner's real settings from the screenshots.
const quill = { id: "q", name: "Quill", tools: { web: true, browser: false, accounts: false } };
const scout = { id: "s", name: "Scout", tools: { web: true, browser: true, accounts: true } };
const nova = { id: "n", name: "Nova", tools: { web: true, browser: false } };
const bots = [quill, scout, nova];

test("a bot can ask to turn on its own missing abilities; accounts bring the browser", () => {
  const r = abilityRequest({ abilities: ["accounts"], why: "To post on your Facebook page." }, quill, bots, false);
  assert.deepEqual(r, { botId: "q", botName: "Quill", turnOn: ["browser", "accounts"], why: "To post on your Facebook page." });
});

test("only the Chief can ask for another bot", () => {
  assert.match(String(abilityRequest({ bot: "Nova", abilities: ["browser"], why: "x" }, scout, bots, false)), /Only the Chief/);
  const r = abilityRequest({ bot: "@nova", abilities: ["browser"], why: "To open the dashboard." }, quill, bots, true);
  assert.equal(typeof r === "object" && r.botName, "Nova");
});

test("nothing to ask when the bot already has it, and a reason is required", () => {
  assert.match(String(abilityRequest({ abilities: ["accounts"], why: "x" }, scout, bots, false)), /already has/);
  assert.match(String(abilityRequest({ abilities: ["browser"] }, quill, bots, false)), /why/);
  assert.match(String(abilityRequest({ abilities: ["desktop"], why: "x" }, quill, bots, false)), /Say which abilities/);
  assert.match(String(abilityRequest({ bot: "Ghost", abilities: ["web"], why: "x" }, quill, bots, true)), /No bot called "Ghost"/);
});

const team = (over: Record<string, unknown> = {}) => ({
  name: "Launch",
  purpose: "Plan and run the product launch on Facebook.",
  members: ["Scout"],
  new_bots: [{ name: "Lina", role: "Social media copywriter", instructions: "You write short, warm Facebook posts in French and Arabic with a clear call to action." }],
  leader: "Scout",
  ...over,
});

test("the Chief can propose a team with existing and new bots", () => {
  const p = teamPlan(team(), bots, ["Studio"]);
  assert.ok(typeof p === "object");
  assert.deepEqual(p.existing, [{ id: "s", name: "Scout" }]);
  assert.equal(p.created[0]!.name, "Lina");
  assert.equal(p.created[0]!.web, true);
  assert.equal(p.created[0]!.browser, false);
  assert.equal(p.leader, "Scout");
});

test("team proposals are checked before the user sees them", () => {
  assert.match(String(teamPlan(team({ name: "studio" }), bots, ["Studio"])), /already a group/);
  assert.match(String(teamPlan(team({ members: ["Ghost"] }), bots, [])), /No bot called "Ghost"/);
  assert.match(String(teamPlan(team({ new_bots: [{ name: "Scout", role: "x", instructions: "x".repeat(50) }] }), bots, [])), /already a bot called Scout/);
  assert.match(String(teamPlan(team({ new_bots: [{ name: "two words", role: "x", instructions: "x".repeat(50) }] }), bots, [])), /one word/);
  assert.match(String(teamPlan(team({ new_bots: [{ name: "Ali", role: "Writer", instructions: "short" }] }), bots, [])), /fuller instructions/);
  assert.match(String(teamPlan(team({ members: [], new_bots: [] }), bots, [])), /at least 2/);
  assert.match(String(teamPlan(team({ leader: "Nova" }), bots, [])), /leader must be one of the team/);
  assert.match(String(teamPlan(team({ purpose: "" }), bots, [])), /what the team is for/);
});

test("a team never hands out signed-in accounts", () => {
  const p = teamPlan(team({ new_bots: [{ name: "Poster", role: "Poster", instructions: "x".repeat(50), browser: true, accounts: true }] }), bots, []);
  assert.ok(typeof p === "object");
  assert.equal("accounts" in p.created[0]!, false);
  assert.equal(p.created[0]!.browser, true);
});

test("bot names follow exactly the app's rule", () => {
  assert.equal(NAME_RE.source, APP_NAME_RE.source);
  assert.equal(NAME_RE.flags, APP_NAME_RE.flags);
});
