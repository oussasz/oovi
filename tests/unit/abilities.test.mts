import { test } from "node:test";
import assert from "node:assert/strict";
import { abilityLines, abilityWords, abilitiesOf } from "../../lib/abilities.ts";

const L = { abilities: "Abilities", web: "Web search", browser: "Browser", accounts: "Use my signed-in accounts", accountsPlace: "Settings → Your accounts" };
// The owner's real setup in the screenshots: Quill is the Chief; Scout and Nova in the "Studio" group. No bot called Oovi.
const quill = { id: "q", name: "Quill", tools: { web: true, browser: false } };
const scout = { id: "s", name: "Scout", tools: { web: true, browser: true } };
const nova = { id: "n", name: "Nova", tools: { web: true, browser: false } };
const bots = [quill, scout, nova];
const groupsWith = (id: string) => (id === "s" || id === "n" ? ["Studio"] : []);
const all = (lines: string[]) => lines.join("\n");

test("a bot describes its own abilities from its real settings", () => {
  assert.equal(abilityWords(abilitiesOf(quill)), "web search");
  const q = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith }, L));
  assert.match(q, /from your settings right now: web search\./);
  assert.match(q, /You can't open websites, click, type or sign in\. You can't post/);
  assert.doesNotMatch(q, /can't search or read the web/); // it CAN search: don't deny that
  assert.doesNotMatch(q, /Oovi/); // never a bot the user doesn't have
});

test("the Chief without a browser says how to turn it on and which group can do it now", () => {
  const q = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith }, L));
  assert.match(q, /turn on "Browser" and "Use my signed-in accounts" \(Scout already has the browser, so for Scout only "Use my signed-in accounts" is needed\)/);
  assert.match(q, /sign in under "Settings → Your accounts"/);
  assert.match(q, /Scout can do it now: Scout is in "Studio", so you can give that group the job with message_group/);
});

test("a bot with a browser but no accounts explains the one missing setting instead of refusing", () => {
  const s = all(abilityLines(scout, bots, { kind: "direct", isMain: false }, L));
  assert.match(s, /turn on "Use my signed-in accounts"/);
  assert.doesNotMatch(s, /turn on "Browser"/); // it already has it
  assert.match(s, /don't just refuse/);
  assert.match(s, /fresh, private one/);
  // Nobody has accounts yet: no bot is named as able to post.
  assert.doesNotMatch(s, /ask (Quill|Nova)/);
});

test("with signed-in accounts the bot starts right away and shows the text before posting", () => {
  const poster = { ...scout, tools: { web: true, browser: true, accounts: true } };
  const p = all(abilityLines(poster, [quill, poster, nova], { kind: "direct", isMain: false }, L));
  assert.match(p, /signed in to the user's accounts/);
  assert.match(p, /start right away: open the site/);
  assert.match(p, /Show the exact text before you post/);
  // The others are pointed to it by name.
  const q = all(abilityLines(quill, [quill, poster, nova], { kind: "direct", isMain: false }, L));
  assert.match(q, /Scout can do it now: the user can ask them directly/);
});

test("in a group, the bot @mentions the teammate who can", () => {
  const n = all(abilityLines(nova, bots, { kind: "group", isMain: false }, L));
  assert.match(n, /@mention Scout with the task/);
  // In a group, the pencil opens the group's settings: the steps must point to the bot's own settings.
  assert.match(n, /open Nova's settings \(Nova in the bots list, then the pencil at the top of its chat\)/);
});

test("accounts without a browser never counts (the setting needs the browser)", () => {
  assert.equal(abilitiesOf({ id: "x", name: "X", tools: { web: false, browser: false, accounts: true } }).accounts, false);
});
