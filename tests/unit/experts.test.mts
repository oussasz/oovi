import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { expertChanges, forScreens } from "../../lib/experts-core.ts";
import { PLUGINS } from "../../lib/catalog.ts";
import { EXPERT_PROMPTS, builtinExpertPrompt } from "../../lib/expert-prompts.ts";
import { botDirectory } from "../../lib/abilities.ts";

// Private experts: bots people already added follow the catalog, and their instructions never reach the screens.
const item = (over = {}) => ({ id: "coach", protected: true, bots: [{ role: "Coach", about: "new line", instructions: "NEW" }], ...over });
const bot = (over = {}) => ({ id: "b1", role: "Coach", about: "old line", instructions: "OLD", ...over });
const none = () => "";

test("a bot added before the change gets the new character and is marked private", () => {
  const c = expertChanges([bot()], [{ id: "coach", botIds: ["b1"] }], [item()], none);
  assert.deepEqual(c, [{ botId: "b1", set: { role: "Coach", about: "new line", instructions: "NEW", expert: "coach" } }]);
});

test("nothing to do when it is already in step", () => {
  const b = bot({ about: "new line", instructions: "NEW", expert: "coach" });
  assert.deepEqual(expertChanges([b], [{ id: "coach", botIds: ["b1"] }], [item()], none), []);
});

test("an edit made on the computer is put back (the character can't be changed there)", () => {
  const b = bot({ about: "new line", instructions: "hacked", expert: "coach" });
  assert.equal(expertChanges([b], [{ id: "coach", botIds: ["b1"] }], [item()], none).length, 1);
});

test("the built-in text is used when the catalog item carries none, and a bot is never emptied", () => {
  const empty = item({ bots: [{ role: "Coach", instructions: "" }] });
  const c = expertChanges([bot()], [{ id: "coach", botIds: ["b1"] }], [empty], (id, i) => (id === "coach" && i === 0 ? "BUILT-IN" : ""));
  assert.equal((c[0] as { set: { instructions: string } }).set.instructions, "BUILT-IN");
  assert.deepEqual(expertChanges([bot()], [{ id: "coach", botIds: ["b1"] }], [empty], none), []);
});

test("offline or unpublished (item missing): the bot keeps what it has, and stays locked", () => {
  const b = bot({ expert: "coach" });
  assert.deepEqual(expertChanges([b], [{ id: "coach", botIds: ["b1"] }], [], none), []);
});

test("an item that is no longer private unlocks its bots; ordinary setups are never touched", () => {
  assert.deepEqual(expertChanges([bot({ expert: "coach" })], [{ id: "coach", botIds: ["b1"] }], [item({ protected: false })], none), [{ botId: "b1", unlock: true }]);
  assert.deepEqual(expertChanges([bot()], [{ id: "team", botIds: ["b1"] }], [{ id: "team", bots: [{ role: "X", instructions: "other" }] }], none), []);
});

test("a locked bot whose record was lost is unlocked; the user's own bots are left alone", () => {
  assert.deepEqual(expertChanges([bot({ expert: "coach" }), bot({ id: "mine" })], [], [item()], none), [{ botId: "b1", unlock: true }]);
});

test("the screens never get a private expert's instructions; other bots are unchanged", () => {
  assert.equal(forScreens({ id: "b1", instructions: "SECRET", expert: "coach" }).instructions, "");
  assert.equal(forScreens({ id: "b2", instructions: "mine" }).instructions, "mine");
});

test("built-in private experts: the text is not in lib/catalog.ts (part of the screens), it is in lib/expert-prompts.ts", () => {
  const priv = PLUGINS.filter((p) => p.protected);
  assert.ok(priv.some((p) => p.id === "abdelaziz-benkirat"));
  for (const p of priv) p.bots.forEach((b, i) => {
    assert.equal(b.instructions, "", `${p.id}: instructions must stay out of lib/catalog.ts`);
    assert.ok(builtinExpertPrompt(p.id, i).length > 200, `${p.id}: no private text for bot ${i}`);
  });
  for (const id of Object.keys(EXPERT_PROMPTS)) assert.ok(priv.some((p) => p.id === id), `${id} has a private text but is not marked protected`);
  // no component may import the private text
  for (const dir of ["components", "app"]) for (const f of fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }) as string[]) {
    if (!/\.(tsx?|mts)$/.test(f) || f.includes("api/")) continue;
    assert.ok(!fs.readFileSync(new URL(`../../${dir}/${f}`, import.meta.url), "utf8").includes("expert-prompts"), `${dir}/${f} imports the private text`);
  }
});

test("the coach has no catchphrase to repeat (the old one opened every conversation)", () => {
  const p = PLUGINS.find((x) => x.id === "abdelaziz-benkirat")!;
  assert.ok(!/coffee first/i.test(p.bots[0]!.about ?? "") && !/coffee first/i.test(builtinExpertPrompt(p.id, 0)));
});

test("other bots (the Chief's list of the team) never see a private expert's instructions", () => {
  const tools = { web: true, browser: false, accounts: false };
  const lines = botDirectory(
    [{ id: "a", name: "Coach", role: "Coach", instructions: "SECRET CHARACTER", expert: "coach", tools }, { id: "b", name: "Dev", role: "Dev", instructions: "dashboard at https://x.test", tools }] as never,
    "z",
    () => [],
  ).join("\n");
  assert.ok(!lines.includes("SECRET CHARACTER") && lines.includes("https://x.test"));
});
