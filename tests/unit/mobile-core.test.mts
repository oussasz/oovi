import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityOf,
  chatMarkdown,
  exportName,
  findInChat,
  isPinned,
  editBotItem,
  editGroupItem,
  setupWithoutBot,
  agoShort,
  backoffMs,
  bytesLabel,
  chatBlocker,
  chatPreview,
  chatTitle,
  computerState,
  decisionsFor,
  foldText,
  isUnread,
  listTime,
  liveActivity,
  matchesQuery,
  needsComputerAction,
  newId,
  pendingOutgoing,
  phoneSetup,
  pickLang,
  plainPreview,
  slimChat,
  sortChats,
  syncUse,
  textDir,
  togglePin,
} from "../../web/app/m/_lib/core.ts";
import { STRINGS, translate } from "../../web/app/m/_lib/i18n.ts";
import type { Chat, CloudStatus } from "../../web/app/m/_lib/types.ts";

const chat = (over: Partial<Chat> = {}): Chat => ({ id: "c1", kind: "direct", name: "Nova", memberIds: ["b1"], createdAt: 1, updatedAt: 10, entries: [], ...over });
const names = { botName: (id: string) => ({ b1: "Nova", b2: "Rex" })[id] ?? "?", you: "You", working: "is working…", failed: "Something went wrong" };

test("search folds case, French accents and Arabic vowel marks and letter forms", () => {
  assert.equal(foldText("  Éléphant  Été "), "elephant ete");
  assert.equal(foldText("أَحْمَد"), foldText("احمد"));
  assert.equal(foldText("مدرسة"), foldText("مدرسه"));
  assert.equal(foldText("على"), foldText("علي"));
  assert.ok(matchesQuery("hotel oran", ["Hôtels à Oran", "Nova"]));
  assert.ok(matchesQuery("فندق", ["فُنْدُق وهران"]));
  assert.ok(!matchesQuery("paris", ["Hôtels à Oran"]));
  assert.ok(matchesQuery("   ", ["anything"]));
});

test("previews drop Markdown, links and tables and are cut", () => {
  assert.equal(plainPreview("## Title\n**Bold** and [a link](https://x.y) `code`"), "Title Bold and a link code");
  assert.equal(plainPreview("| a | b |\n|---|---|\n| 1 | 2 |"), "a b 1 2");
  const long = plainPreview("word ".repeat(100), 20);
  assert.ok(long.length <= 20 && long.endsWith("…"));
});

test("text direction follows the first strong letter (Arabic, Darija in Arabic letters, Latin Darija)", () => {
  assert.equal(textDir("سلام، واش راك؟"), "rtl");
  assert.equal(textDir("123 مرحبا"), "rtl");
  assert.equal(textDir("wach rak? 3tini"), "ltr");
  assert.equal(textDir("Bonjour سلام"), "ltr");
  assert.equal(textDir("123"), "ltr");
});

test("language: saved choice, then the browser's list, else English", () => {
  assert.equal(pickLang(["ar-DZ", "fr"]), "ar");
  assert.equal(pickLang(["de-DE", "fr-FR"]), "fr");
  assert.equal(pickLang(["de"]), "en");
  assert.equal(pickLang(["ar"], "fr"), "fr");
  assert.equal(pickLang(undefined, "nope"), "en");
});

test("every language has every word, and placeholders match English", () => {
  const keys = Object.keys(STRINGS.en);
  for (const lang of ["fr", "ar"] as const) {
    assert.deepEqual(Object.keys(STRINGS[lang]).sort(), [...keys].sort(), lang);
    for (const k of keys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      assert.equal(ph(STRINGS[lang][k as keyof typeof STRINGS.en]), ph(STRINGS.en[k as keyof typeof STRINGS.en]), `${lang} ${k}`);
    }
  }
  assert.equal(translate("fr", "chat.messageTo", { name: "Nova" }), "Message à Nova");
});

test("list times: today's time, yesterday, weekday, then a date (Latin digits in Arabic too)", () => {
  const now = Date.UTC(2026, 10, 18, 15, 0); // Wednesday
  assert.match(listTime(Date.UTC(2026, 10, 18, 9, 5), now, "en"), /9:05/);
  assert.equal(listTime(Date.UTC(2026, 10, 17, 23, 0), now, "en"), "Yesterday");
  assert.equal(listTime(Date.UTC(2026, 10, 17, 23, 0), now, "ar"), "أمس");
  assert.equal(listTime(Date.UTC(2026, 10, 15, 8, 0), now, "en"), "Sunday");
  assert.equal(listTime(Date.UTC(2026, 10, 15, 8, 0), now, "fr"), "dimanche");
  assert.match(listTime(Date.UTC(2026, 9, 1, 8, 0), now, "ar").replace(/\u200f/g, ""), /^[0-9/]+$/);
  // Just after midnight in Algiers (UTC+1, offset -60) is "today", not yesterday.
  assert.match(listTime(Date.UTC(2026, 10, 17, 23, 30), Date.UTC(2026, 10, 18, 9, 0), "en", -60, "Africa/Algiers"), /12:30/);
});

test("ago and sizes", () => {
  assert.equal(agoShort(1000, 1000 + 30_000, "en"), "just now");
  assert.equal(agoShort(0, 5 * 60_000, "en"), "5 min ago");
  assert.equal(agoShort(0, 3 * 3600_000, "fr"), "il y a 3 h");
  assert.equal(bytesLabel(1536, "en"), "1.5 KB");
  assert.equal(bytesLabel(1536, "fr"), "1,5 Ko");
  assert.equal(bytesLabel(100 * 1024 * 1024, "en"), "100 MB");
  assert.equal(bytesLabel(12, "en"), "12 B");
});

test("setup: bots, groups and connectors with name and on/off only (no commands, addresses or keys kept)", () => {
  const s = phoneSetup({
    "bot:b2": { name: "Rex", role: "Research", instructions: "secret", face: { color: 1 }, createdAt: 2 },
    "bot:b1": { name: "Oovi", role: "Chief", instructions: "x", face: { color: 0 }, createdAt: 5 },
    "bot:bad": { role: "no name" },
    "group:g1": { name: "Studio", memberIds: ["b1", "b2", 3], leadId: "b1" },
    "mcp:m1": { name: "Notion", transport: "http", url: "https://mcp.notion.com/?token=abc", envKeys: ["NOTION_KEY"], enabled: true },
    "mcp:m2": { name: "Files", transport: "stdio", command: "npx", args: ["-y", "x"], enabled: false },
    main: "b1",
    settings: { approvals: "ask" },
  });
  assert.deepEqual(s.bots.map((b) => b.id), ["b1", "b2"]);
  assert.equal(s.mainId, "b1");
  assert.ok(!JSON.stringify(s).includes("secret"));
  assert.ok(!JSON.stringify(s).includes("token=abc"));
  assert.ok(!JSON.stringify(s).includes("NOTION_KEY"));
  assert.ok(!JSON.stringify(s).includes("npx"));
  assert.deepEqual(s.connectors, [
    { id: "m2", name: "Files", enabled: false, kind: "local" },
    { id: "m1", name: "Notion", enabled: true, kind: "remote" },
  ]);
  assert.deepEqual(s.groups[0]!.memberIds, ["b1", "b2"]);
  assert.deepEqual(phoneSetup(null), { bots: [], groups: [], connectors: [], mainId: null, routines: [] });
});

test("slim chats keep text and the running reply's last step, drop tool results", () => {
  const c = chat({
    entries: [
      { id: "u1", kind: "user", text: "find hotels", at: 1 },
      { id: "e1", kind: "bot", botId: "b1", at: 2, text: "done", status: "done", steps: [{ role: "tool", results: [{ id: "t", name: "web_search", content: "BIG".repeat(1000) }] }] },
      { id: "e2", kind: "bot", botId: "b1", at: 3, text: "", status: "running", steps: [{ role: "assistant", text: "x", toolCalls: [{ id: "a", name: "web_search", input: { query: "q" } }, { id: "b", name: "read_url", input: { url: "https://www.booking.com/x" } }] }, { role: "tool", results: [{ id: "b", name: "read_url", content: "BIG" }] }] },
    ],
  });
  const s = slimChat(c);
  assert.ok(!JSON.stringify(s).includes("BIG"));
  const run = s.entries[2] as { steps: unknown[] };
  assert.equal(run.steps.length, 2);
  assert.equal(liveActivity(s.entries[2] as never, "en").label, "Thinking…");
  assert.equal(slimChat(chat({ entries: Array.from({ length: 200 }, (_, i) => ({ id: `u${i}`, kind: "user" as const, text: "x", at: i })) }), 50).entries.length, 50);
});

test("previews and titles for direct chats and groups", () => {
  const c = chat({ entries: [{ id: "u1", kind: "user", text: "**hi**", at: 1 }] });
  assert.equal(chatPreview(c, names), "You: hi");
  const g = chat({ kind: "group", name: "", memberIds: ["b1", "b2"], entries: [{ id: "e", kind: "bot", botId: "b2", at: 2, text: "", status: "running" }] });
  assert.equal(chatPreview(g, names), "Rex: is working…");
  assert.equal(chatTitle(g, names.botName), "Nova, Rex");
  assert.equal(chatTitle(c, (id) => (id === "b1" ? "Nova 2" : undefined)), "Nova 2");
  assert.equal(chatPreview(chat(), names), "");
});

test("unread, pins and order", () => {
  const a = chat({ id: "a", updatedAt: 50, entries: [{ id: "e", kind: "bot", botId: "b1", at: 50, text: "news", status: "done" }] });
  const b = chat({ id: "b", updatedAt: 90, entries: [{ id: "u", kind: "user", text: "hi", at: 90 }] });
  const r = chat({ id: "r", routine: "x", entries: [{ id: "u", kind: "user", text: "hi", at: 99 }] });
  const p = chat({ id: "p", updatedAt: 10, pinned: true, entries: [{ id: "u", kind: "user", text: "hi", at: 10 }] });
  assert.equal(isUnread(a, 40), true);
  assert.equal(isUnread(a, 50), false);
  assert.equal(isUnread(a, undefined), false, "no baseline yet: nothing is unread");
  assert.equal(isUnread(b, 0), false, "the user's own message is never unread");
  const rows = sortChats([a, b, r, p], [], { a: 0 });
  assert.deepEqual(rows.map((x) => x.chat.id), ["p", "b", "a"]);
  assert.equal(rows[2]!.unread, true);
  const pins = togglePin([], a);
  assert.deepEqual(sortChats([a, b, p], pins, {}).map((x) => x.chat.id), ["p", "a", "b"]);
  const unpinP = togglePin(pins, p);
  assert.deepEqual(unpinP, ["a", "-p"]);
  assert.deepEqual(sortChats([a, b, p], unpinP, {}).map((x) => x.chat.id), ["a", "b", "p"]);
  assert.deepEqual(togglePin(unpinP, p), ["a"]);
  assert.deepEqual(togglePin(["a"], a), []);
});

test("live status from the last tool call, in three languages", () => {
  assert.deepEqual(activityOf({ id: "1", name: "web_search", input: { query: "x" } }, "en"), { mood: "reading", label: "Searching the web" });
  assert.equal(activityOf({ id: "1", name: "read_url", input: { url: "https://www.booking.com/a" } }, "fr").label, "Lit booking.com");
  assert.equal(activityOf({ id: "1", name: "click", input: {} }, "ar").mood, "computer");
  assert.equal(activityOf({ id: "1", name: "create_document", input: { filename: "C:\\Users\\me\\report.docx" } }, "en").label, "Creating report.docx");
  assert.equal(activityOf({ id: "1", name: "mcp_notion_search", input: {} }, "en").label, "Using notion search");
  assert.equal(activityOf(undefined, "ar").label, "يفكّر…");
  assert.equal(liveActivity({ id: "e", kind: "bot", botId: "b", at: 1, text: "", status: "running", steps: [{ role: "assistant", text: "Hello", toolCalls: [] }] }, "en").label, "typing…");
});

test("approval decisions and computer-only actions", () => {
  const items = [
    { call: { id: "a", name: "mcp_gmail_send", input: {} }, summary: "Send an email" },
    { call: { id: "b", name: "desktop_left_click", input: {} }, summary: "Click", desktop: "action" as const },
    { call: { id: "c", name: "write_file", input: {} }, summary: "Write" },
  ];
  assert.deepEqual(decisionsFor(items, true), { a: true, b: true, c: true });
  assert.deepEqual(decisionsFor(items, false), { a: false, b: false, c: false });
  assert.deepEqual(items.map(needsComputerAction), [false, true, true]);
});

test("the phone's own messages show until the chat has them", () => {
  const out = [
    { entryId: "m1", chatId: "c1", text: "first", at: 1000, state: "sent" as const },
    { entryId: "m2", chatId: "c1", text: "second", at: 2000, state: "sending" as const },
    { entryId: "m3", chatId: "c1", text: "third", at: 300_000, state: "failed" as const },
  ];
  const c = chat({ entries: [{ id: "m1", kind: "user", text: "first", at: 1100 }, { id: "zz", kind: "user", text: "second ", at: 2500 }, { id: "yy", kind: "user", text: "third", at: 1000 }] });
  assert.deepEqual(pendingOutgoing(c, out).map((o) => o.entryId), ["m3"]);
  assert.equal(pendingOutgoing(undefined, out).length, 3);
  const id = newId();
  assert.match(id, /^m[a-z0-9]{12}$/);
});

test("computer state, the needs-your-computer banner and sync use", () => {
  const st = (devices: CloudStatus["devices"]): CloudStatus => ({ enabled: true, bytes: 25, limit: 100, chats: 3, lastSync: null, devices });
  assert.equal(computerState(null).state, "none");
  assert.equal(computerState(st([{ deviceId: "p", kind: "phone", lastSeen: "2026-11-18T10:00:00Z", online: true }])).state, "none");
  const off = computerState(st([
    { deviceId: "d1", kind: "desktop", lastSeen: "2026-11-18T09:00:00Z", online: false },
    { deviceId: "d2", kind: "desktop", lastSeen: "2026-11-18T10:00:00Z", online: false },
  ]));
  assert.equal(off.state, "offline");
  assert.equal(off.device?.deviceId, "d2");
  assert.equal(computerState(st([{ deviceId: "d1", kind: "desktop", lastSeen: "2026-11-18T09:00:00Z", online: true }])).state, "online");
  assert.equal(syncUse(st([])), 0.25);
  assert.equal(syncUse(null), 0);

  const job = (status: "queued" | "needs_computer") => ({ jobId: "j", kind: "message" as const, status, createdAt: "" });
  assert.equal(chatBlocker(chat(), [job("needs_computer")], "online", false), "needs_computer");
  const runnerSaid = chat({ entries: [{ id: "u", kind: "user", text: "open my file", at: 1 }, { id: "e", kind: "bot", botId: "b1", at: 2, text: "This needs your computer", status: "done", errorCode: "needs_computer" }] });
  assert.equal(chatBlocker(runnerSaid, [], "offline", false), "needs_computer");
  const answeredLater = chat({ entries: [...runnerSaid.entries, { id: "u2", kind: "user", text: "ok", at: 3 }] });
  assert.equal(chatBlocker(answeredLater, [], "offline", false), null);
  assert.equal(chatBlocker(chat(), [job("queued")], "offline", true), "queued_offline");
  assert.equal(chatBlocker(chat(), [job("queued")], "online", true), null);
});

test("long-poll backoff grows to 30 s", () => {
  assert.deepEqual([0, 1, 2, 3, 6, 20].map(backoffMs), [1000, 1000, 2000, 4000, 30000, 30000]);
});

test("time stamps between messages: first, new day, or after an hour", async () => {
  const { needsStamp, stampLabel } = await import("../../web/app/m/_lib/core.ts");
  const t0 = Date.UTC(2026, 10, 18, 10, 0);
  assert.equal(needsStamp(undefined, t0), true);
  assert.equal(needsStamp(t0, t0 + 30 * 60_000), false);
  assert.equal(needsStamp(t0, t0 + 61 * 60_000), true);
  assert.equal(needsStamp(Date.UTC(2026, 10, 17, 23, 50), Date.UTC(2026, 10, 18, 0, 5)), true);
  assert.match(stampLabel(t0, t0 + 1000, "en", "Today"), /^Today 10:00/);
  assert.match(stampLabel(t0 - 86_400_000, t0, "fr", "Aujourd’hui"), /^Hier 10:00/);
});

test("two identical messages sent quickly stay two until the chat shows both", () => {
  const out = [
    { entryId: "m1", chatId: "c1", text: "ok", at: 1000, state: "sent" as const },
    { entryId: "m2", chatId: "c1", text: "ok", at: 2000, state: "sent" as const },
  ];
  const one = chat({ entries: [{ id: "desk-1", kind: "user", text: "ok", at: 1500 }] });
  assert.deepEqual(pendingOutgoing(one, out).map((o) => o.entryId), ["m2"]);
  const both = chat({ entries: [{ id: "desk-1", kind: "user", text: "ok", at: 1500 }, { id: "desk-2", kind: "user", text: "ok", at: 2500 }] });
  assert.deepEqual(pendingOutgoing(both, out), []);
  const byId = chat({ entries: [{ id: "m2", kind: "user", text: "ok", at: 2500 }] });
  assert.deepEqual(pendingOutgoing(byId, out).map((o) => o.entryId), ["m1"], "the id match is not reused by text");
});

test("after sign-in, only pages of the phone app (never another site)", async () => {
  const { safeMobileNext } = await import("../../web/app/m/_lib/core.ts");
  assert.equal(safeMobileNext("/m/c/dm-oovi"), "/m/c/dm-oovi");
  assert.equal(safeMobileNext("/m/settings?x=1"), "/m/settings?x=1");
  for (const bad of ["https://evil.example", "//evil.example", "/m/../admin", "/admin", "/mark.png", "/m/login?next=/m", "/m\\evil", null, ""]) assert.equal(safeMobileNext(bad), "/m", String(bad));
});

test("messenger habits: unread counts, archive, ticks, quotes", async () => {
  const { unreadCount, splitArchived, toggleArchive, userTick, quoteOf } = await import("../../web/app/m/_lib/core.ts");
  const c = chat({
    entries: [
      { id: "u1", kind: "user", text: "hi", at: 10 },
      { id: "b1", kind: "bot", botId: "b1", at: 20, text: "one", status: "done" },
      { id: "b2", kind: "bot", botId: "b1", at: 30, text: "two", status: "done" },
      { id: "b3", kind: "bot", botId: "b1", at: 40, text: "", status: "running" },
      { id: "u2", kind: "user", text: "ok", at: 50 },
    ],
  });
  assert.equal(unreadCount(c, 15), 2);
  assert.equal(unreadCount(c, 25), 1);
  assert.equal(unreadCount(c, undefined), 0);
  const rows = [{ chat: { id: "a" } }, { chat: { id: "b" } }];
  assert.deepEqual(splitArchived(rows, ["b"]), { main: [rows[0]], archived: [rows[1]] });
  assert.deepEqual(toggleArchive(toggleArchive([], "x"), "x"), []);
  assert.equal(userTick(c, "u1"), "read");
  assert.equal(userTick(c, "u2"), "delivered");
  assert.equal(quoteOf("**Bold** reply with [a link](https://x)"), "Bold reply with a link");
});

test("after sign-in: only the phone app's pages (the web version was removed)", async () => {
  const { safeMobileNext } = await import("../../web/app/m/_lib/core.ts");
  assert.equal(safeMobileNext("/app"), "/m");
  assert.equal(safeMobileNext("/app/c/dm-oovi"), "/m");
  assert.equal(safeMobileNext("/m/c/dm-oovi"), "/m/c/dm-oovi");
  assert.equal(safeMobileNext("/apple"), "/m");
  assert.equal(safeMobileNext("/mx"), "/m");
});

test("one list: chats, then the bots and groups that have no chat yet; new bots and groups", async () => {
  const { chatsWithEveryone, sortChats, botNameProblem, newBotItem, newGroupItem, setupId } = await import("../../web/app/m/_lib/core.ts");
  const setup = {
    mainId: "b1",
    connectors: [],
    bots: [
      { id: "b1", name: "Nova", role: "", face: {} },
      { id: "b2", name: "Rex", role: "Writer", face: {} },
      { id: "b3", name: "Ghost", role: "", face: {}, hidden: true },
    ],
    groups: [{ id: "g1", name: "Studio", memberIds: ["b1", "b2"] }, { id: "g2", name: "Empty", memberIds: [] }],
  };
  const talked = chat({ id: "dm-b1", memberIds: ["b1"], entries: [{ id: "u", kind: "user", text: "hi", at: 5 }] });
  const all = chatsWithEveryone([talked], setup);
  assert.deepEqual(all.map((c) => c.id), ["dm-b1", "g1", "dm-b2"]);
  assert.deepEqual(sortChats(all, [], {}).map((r) => r.chat.id)[0], "dm-b1");
  assert.equal(botNameProblem("", []), "empty");
  assert.equal(botNameProblem("Two words", []), "oneWord");
  assert.equal(botNameProblem("nova", ["Nova"]), "taken");
  assert.equal(botNameProblem("سامي", []), null);
  const bot = newBotItem({ name: " Sami ", role: "Accountant", face: { color: 1 } }, 9);
  assert.equal(bot.name, "Sami");
  assert.match(String(bot.instructions), /^You are Sami, Accountant\./);
  assert.deepEqual(bot.tools, { web: true, browser: false });
  assert.deepEqual(newGroupItem({ name: "Team", memberIds: ["b2", "b1", "b2"] }, 3), { name: "Team", memberIds: ["b2", "b1"], leadId: "b2", orchestrate: true, createdAt: 3 });
  assert.equal(newGroupItem({ name: "", memberIds: ["b1"] }, 3), null);
  assert.match(setupId(), /^[0-9a-f]{12}$/);
});

test("editing a bot keeps what the phone doesn't change (model, connectors, expert), and follows the computer's rules", () => {
  const item = { name: "Rex", role: "Writer", instructions: "Write.", face: { color: 1 }, tools: { web: true, browser: true, accounts: true, mcp: ["gmail"] }, provider: "openai", model: "x", createdAt: 5 };
  const out = editBotItem(item, { name: " Rex Two ", role: "  Editor ", about: "", tools: { browser: false }, hidden: true });
  assert.equal(out.name, "RexTwo");
  assert.equal(out.role, "Editor");
  assert.equal("about" in out, false);
  assert.deepEqual(out.tools, { web: true, browser: false, accounts: false, mcp: ["gmail"] });
  assert.equal(out.provider, "openai");
  assert.equal(out.model, "x");
  assert.equal(out.createdAt, 5);
  assert.equal(out.hidden, true);
  assert.equal("hidden" in editBotItem(out, { hidden: false }), false);
  assert.equal(editBotItem(item, { local: true }).local, true);
  // An expert's character is oovi's: role and instructions stay.
  const ex = editBotItem({ ...item, expert: "m1" }, { role: "Hacked", instructions: "Hacked", name: "Ex" });
  assert.equal(ex.role, "Writer");
  assert.equal(ex.instructions, "Write.");
  assert.equal(ex.name, "Ex");
  assert.equal(String(editBotItem(item, { name: "a".repeat(40) }).name).length, 24);
});

test("editing a group: a name, at least one member, the leader is a member", () => {
  const g = { name: "Studio", memberIds: ["a", "b"], leadId: "b", orchestrate: true, createdAt: 1 };
  assert.deepEqual(editGroupItem(g, { name: " Team ", memberIds: ["a", "c", "a"] }), { name: "Team", memberIds: ["a", "c"], leadId: "a", orchestrate: true, createdAt: 1 });
  assert.equal(editGroupItem(g, { leadId: "a" })?.leadId, "a");
  assert.equal(editGroupItem(g, { orchestrate: false })?.orchestrate, false);
  assert.equal(editGroupItem(g, { name: "  " }), null);
  assert.equal(editGroupItem(g, { memberIds: [] }), null);
});

test("deleting a bot, as the computer does: it leaves its groups and is no longer the Chief", () => {
  const items = { "bot:a": { name: "A" }, "bot:b": { name: "B" }, "group:g": { name: "G", memberIds: ["a", "b"], leadId: "a" }, "group:h": { name: "H", memberIds: ["b"], leadId: "b" }, main: "a", settings: { x: 1 } };
  const out = setupWithoutBot(items, "a");
  assert.equal("bot:a" in out, false);
  assert.equal("main" in out, false);
  assert.deepEqual(out["group:g"], { name: "G", memberIds: ["b"], leadId: "b" });
  assert.deepEqual(out["group:h"], items["group:h"]);
  assert.deepEqual(out.settings, { x: 1 });
  assert.equal(setupWithoutBot(items, "b").main, "a");
});

test("download a chat as Markdown, like the computer: who and when, quotes, no inner steps", () => {
  const chat = {
    id: "dm-rex",
    kind: "direct",
    name: "Rex",
    memberIds: ["rex"],
    createdAt: 0,
    updatedAt: 0,
    entries: [
      { id: "u1", kind: "user", text: "Hi", at: Date.UTC(2026, 10, 19, 8, 5) },
      { id: "b1", kind: "bot", botId: "rex", text: "Hello **you**", status: "done", at: Date.UTC(2026, 10, 19, 8, 6), steps: [{ role: "tool", results: [] }] },
      { id: "u2", kind: "user", text: "More", at: Date.UTC(2026, 10, 19, 8, 7), replyTo: { id: "b1", who: "Rex", text: "Hello\nyou" } },
      { id: "b2", kind: "bot", botId: "rex", text: "", status: "running", at: Date.UTC(2026, 10, 19, 8, 8) },
    ],
  } as never;
  const md = chatMarkdown(chat, "Rex", (id) => (id === "rex" ? "Rex" : id), Date.UTC(2026, 10, 19, 9, 0));
  assert.equal(md, "# Rex\n\n_Exported from oovi on 2026-11-19 09:00 (UTC)._\n\n## You · 2026-11-19 08:05\n\nHi\n\n## Rex · 2026-11-19 08:06\n\nHello **you**\n\n## You · 2026-11-19 08:07\n\n> Rex: Hello you\n\nMore\n");
  assert.equal(exportName('A/B: "c"?'), "A B c .md".replace("c .md", "c.md"));
  assert.equal(exportName("   "), "oovi chat.md");
  assert.deepEqual(findInChat((chat as { entries: never[] }).entries, "HELLO"), ["b1"]);
  assert.deepEqual(findInChat((chat as { entries: never[] }).entries, " "), []);
  assert.equal(isPinned(["-x"], { id: "x", pinned: true }), false);
  assert.equal(isPinned([], { id: "x", pinned: true }), true);
});

test("routines from the account's setup: read-only, when they run in words", async () => {
  const { phoneSetup, routineWhen } = await import("../../web/app/m/_lib/core.ts");
  const s = phoneSetup({
    "routine:r1": { name: "Morning news", botId: "b1", prompt: "secret prompt", schedule: { kind: "weekly", time: "08:30", days: [1, 3] }, timezone: "Africa/Algiers" },
    "routine:r2": { name: "Watch", botId: "b1", schedule: { kind: "hourly", every: 2, from: "07:00" } },
    "routine:bad": { name: "", botId: "b1" },
  });
  assert.equal(s.routines?.length, 2);
  assert.deepEqual(s.routines?.[0], { id: "r1", name: "Morning news", botId: "b1", schedule: { kind: "weekly", time: "08:30", days: [1, 3] }, timezone: "Africa/Algiers" });
  assert.equal(JSON.stringify(s).includes("secret prompt"), false);
  assert.deepEqual(routineWhen({ kind: "weekly", time: "08:30", days: [1, 3] }, "en"), { key: "weekly", vars: { time: "08:30", days: "Mon, Wed" } });
  assert.deepEqual(routineWhen({ kind: "hourly", every: 2 }, "en"), { key: "hourly", vars: { n: "2" } });
  assert.equal(routineWhen({ kind: "webhook" }, "fr").key, "webhook");
  assert.equal(routineWhen({ kind: "?" }, "ar").key, "other");
});
