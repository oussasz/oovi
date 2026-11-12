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
  assert.match(q, /Then they sign in once under "Settings → Your accounts"/);
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

test("when the card is available, the bot offers it instead of sending the user through menus", () => {
  const q = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith, canRequest: true }, L));
  assert.match(q, /call request_abilities for "Browser" and "Use my signed-in accounts": the user turns it on with one click/);
  assert.match(q, /if they'd rather do it themselves, they can open your settings/); // the menus stay as a fallback
  // A routine run (no card): menus only.
  const r = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith, canRequest: false }, L));
  assert.doesNotMatch(r, /request_abilities/);
});

import { botDirectory, DIRECTORY_DESC, DIRECTORY_MAX } from "../../lib/abilities.ts";

test("the Chief sees each bot's description, so a link one bot holds isn't lost (the dashboard case)", () => {
  const c = { id: "c", name: "c", role: "Business analyst", instructions: "You read the Business OS at https://profiles-x.trycloudflare.com every morning.", tools: { web: true, browser: true } };
  const m = { id: "m", name: "mouloud", role: "Assistant", instructions: "", tools: { web: false, browser: false }, hidden: true };
  const d = botDirectory([quill, c, m], "q", (id) => (id === "c" || id === "m" ? ["Business"] : [])).join("\n");
  assert.match(d, /- c, Business analyst\. Abilities: web search, a browser\. Groups: "Business"\. Description: You read the Business OS at https:\/\/profiles-x\.trycloudflare\.com/);
  assert.match(d, /- Quill \(you\)\. Abilities: web search\. Groups: none\./);
  assert.match(d, /mouloud, Assistant \(hidden from the bots list\)\. Abilities: no web access/);
  assert.match(d, /use that information yourself, or give the job to a group it's in/);
});

test("the directory stays bounded", () => {
  const long = { id: "x", name: "X", instructions: "y".repeat(DIRECTORY_DESC + 50), tools: { web: false, browser: false } };
  assert.match(botDirectory([long], "q", () => []).join("\n"), new RegExp(`y{${DIRECTORY_DESC}}…`));
  const many = Array.from({ length: DIRECTORY_MAX + 3 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, tools: { web: false, browser: false } }));
  assert.match(botDirectory(many, "q", () => []).join("\n"), /…and 3 more/);
});

import { hideSecrets } from "../../lib/abilities.ts";

test("secrets in a bot's description don't reach the Chief, links and facts do", () => {
  const t = hideSecrets("Dashboard: https://profiles-x.trycloudflare.com/saas. Key sk-ant-api03-abcdefghijklmnopqrstuv, password: hunter2, Telegram 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw, phone 0772763932");
  assert.match(t, /https:\/\/profiles-x\.trycloudflare\.com\/saas/);
  assert.match(t, /0772763932/);
  assert.doesNotMatch(t, /sk-ant-api03|hunter2|AAHdqTcv/);
  assert.match(t, /password: \[hidden\]/);
});

test("a bot with desktop control does the user's-own-computer job itself (the Gmail-in-Brave case)", () => {
  // The owner's case: Quill (the Chief, web search only) was asked "use my pc and check my gmail in brave".
  const withDesk = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith, canRequest: true, desktop: true }, L));
  assert.match(withDesk, /You also have desktop control/);
  assert.match(withDesk, /do it yourself that way: don't pass it to another bot or a group/);
  assert.match(withDesk, /You can't open websites, click, type or sign in with a browser of your own\./); // not a flat "you can't"
  // Sending a message for the user goes through their own browser: no ability to ask for first.
  assert.match(withDesk, /To post, comment or send messages on a site as the user[^\n]*do it in their own browser with desktop control\. Open the page with open_in_user_browser/);
  assert.doesNotMatch(withDesk, /a bot needs "Use my signed-in accounts"/);
  assert.doesNotMatch(withDesk, /call request_abilities for "Browser"/);
  assert.match(withDesk, /If a task needs a website opened[^\n]*open_in_user_browser/);
  // Without desktop control nothing about it is claimed.
  const without = all(abilityLines(quill, bots, { kind: "direct", isMain: true, groupsWith, canRequest: true }, L));
  assert.doesNotMatch(without, /desktop control/);
  assert.match(without, /You can't open websites, click, type or sign in\./);
});
