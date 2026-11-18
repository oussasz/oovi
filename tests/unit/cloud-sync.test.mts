import { test } from "node:test";
import assert from "node:assert/strict";
import { agreedBase, chatHash, chatTravels, entryBase, hasSecret, jobInput, mergeChat, problemOf, retryAfter, scrubSecrets, vaultAction, vaultMerge, type SyncChat } from "../../lib/cloud-sync-core.ts";

const u = (id: string, text: string, at: number) => ({ id, kind: "user", text, at });
const b = (id: string, text: string, at: number, status = "done") => ({ id, kind: "bot", botId: "b1", text, at, status, steps: [] });
const chat = (entries: SyncChat["entries"], updatedAt: number, extra: Record<string, unknown> = {}): SyncChat => ({ id: "c1", kind: "direct", name: "", memberIds: ["b1"], updatedAt, entries, ...extra });

test("a message added on another device is merged in after the entry it followed there", () => {
  const base = chat([u("u1", "hi", 1), b("r1", "hello", 2)], 10);
  const local = chat([...base.entries, u("u2", "here", 5)], 20);
  const remote = chat([...base.entries, u("p1", "from the phone", 4), b("p2", "answer", 6)], 15);
  const m = mergeChat(local, remote, entryBase(base));
  assert.deepEqual(m.entries.map((e) => e.id), ["u1", "r1", "p1", "p2", "u2"]);
  assert.equal(m.updatedAt, 20);
});

test("only one side changed an entry since the last sync: that side wins, whatever the times", () => {
  const base = chat([b("r1", "draft", 2, "running")], 10);
  const local = chat([b("r1", "draft", 2, "running")], 50); // saved later, but unchanged
  const remote = chat([b("r1", "final answer", 2, "done")], 20);
  const m = mergeChat(local, remote, entryBase(base));
  assert.equal(m.entries[0]!.text, "final answer");
});

test("both changed an entry: the newer chat wins; while this computer's bots work, this computer wins", () => {
  const base = chat([b("r1", "a", 2)], 10);
  const local = chat([b("r1", "local edit", 2)], 30);
  const remote = chat([b("r1", "remote edit", 2)], 40);
  assert.equal(mergeChat(local, remote, entryBase(base)).entries[0]!.text, "remote edit");
  assert.equal(mergeChat(local, remote, entryBase(base), true).entries[0]!.text, "local edit");
});

test("deletions: an entry gone on one side is gone, unless the other side changed it since", () => {
  const base = chat([u("u1", "a", 1), u("u2", "b", 2), u("u3", "c", 3)], 10);
  const local = chat([u("u1", "a", 1), u("u3", "c (edited)", 3)], 20); // u2 deleted here
  const remote = chat([u("u1", "a", 1), u("u2", "b", 2)], 25); // u3 deleted there, edited here
  const m = mergeChat(local, remote, entryBase(base));
  assert.deepEqual(m.entries.map((e) => e.id), ["u1", "u3"]);
  // A chat cleared on the phone empties here too.
  const cleared = mergeChat(base, chat([], 30), entryBase(base));
  assert.equal(cleared.entries.length, 0);
});

test("first sync (no base): nothing is lost, both sides' entries are kept", () => {
  const local = chat([u("u1", "a", 1), u("u3", "c", 3)], 20);
  const remote = chat([u("u1", "a", 1), u("u2", "b", 2)], 10);
  assert.deepEqual(mergeChat(local, remote, null).entries.map((e) => e.id), ["u1", "u2", "u3"]);
  // Nothing in common: the account's entries go where their time puts them.
  const m2 = mergeChat(chat([u("x", "x", 5)], 20), chat([u("y", "y", 1), u("z", "z", 9)], 10), null);
  assert.deepEqual(m2.entries.map((e) => e.id), ["y", "x", "z"]);
});

test("chat fields come from the newer copy; a summary pointing at a gone entry is dropped", () => {
  const local = chat([u("u1", "a", 1)], 10, { name: "old", summary: { upTo: "u1", text: "s" } });
  const remote = chat([], 20, { name: "new" });
  const m = mergeChat(local, remote, entryBase(local));
  assert.equal(m.name, "new");
  assert.equal(m.entries.length, 0);
  assert.equal(m.summary, undefined);
});

test("fingerprints ignore when a chat was saved and the order of keys", () => {
  const a = chat([u("u1", "a", 1)], 10);
  const c = { ...chat([{ at: 1, text: "a", kind: "user", id: "u1" }], 99) };
  assert.equal(chatHash(a), chatHash(c));
  assert.notEqual(chatHash(a), chatHash(chat([u("u1", "b", 1)], 10)));
});

test("the remembered base holds only the entries this computer saved as merged", () => {
  const merged = chat([u("u1", "a", 1), u("p1", "phone", 2)], 10);
  const savedHere = chat([u("u1", "a", 1)], 10); // the bots were working: the merged copy wasn't saved
  assert.deepEqual(Object.keys(agreedBase(merged, savedHere)), ["u1"]);
  // So next time the phone's entry is still new to this computer, not "deleted here".
  const next = mergeChat(chat([u("u1", "a", 1), b("r1", "reply", 3)], 20), merged, agreedBase(merged, savedHere), true);
  assert.deepEqual(next.entries.map((e) => e.id), ["u1", "p1", "r1"]);
});

test("a chat travels only when every bot in it is in the cloud", () => {
  const bots = [{ id: "a" }, { id: "b", local: true }, { id: "c", local: false }];
  assert.equal(chatTravels({ memberIds: ["a", "c"] }, bots), true);
  assert.equal(chatTravels({ memberIds: ["a", "b"] }, bots), false);
  assert.equal(chatTravels({ memberIds: ["gone"] }, bots), true);
  assert.equal(chatTravels({ memberIds: [] }, bots), false);
});

test("secrets are scrubbed from what is sent, also inside JSON; short strings are left alone", () => {
  const key = 'sk-test-ABCDEFGH"1234';
  const body = JSON.stringify({ chat: { text: `my key is ${key}` }, short: "abc" });
  const out = scrubSecrets(body, [key, "abc"]);
  assert.ok(!out.includes("ABCDEFGH"));
  assert.ok(out.includes("[hidden]") && out.includes('"abc"'));
  assert.equal(hasSecret(body, [key]), true);
  assert.equal(hasSecret(out, [key]), false);
  assert.doesNotThrow(() => JSON.parse(out));
});

test("jobs from the phone are cleaned like the app's own requests", () => {
  assert.deepEqual(jobInput("message", { text: "  hi  ", effort: "high", attachments: ["x"], routine: "r" }), { kind: "run", input: { text: "hi", effort: "high", deep: false, plan: false } });
  assert.equal(jobInput("message", { text: "  " }), null);
  assert.equal(jobInput("message", { text: "x".repeat(20_001) }), null);
  assert.deepEqual(jobInput("stop", null), { kind: "stop" });
  // An approval answer: the yes/no only; "always allow" rules for this computer never come from the phone.
  assert.deepEqual(jobInput("decision", { decisions: { call_1: true, "bad key!": true, call_2: "yes" }, alwaysEdit: true, alwaysFolders: true }), { kind: "run", input: { decisions: { call_1: true }, allowChat: false } });
  assert.deepEqual(jobInput("decision", { planDecision: { approve: true, items: ["a", 2] } }), { kind: "run", input: { planDecision: { approve: true, items: ["a"] } } });
  assert.deepEqual(jobInput("decision", { answers: null }), { kind: "run", input: { answers: null } });
  assert.equal(jobInput("decision", {}), null);
  assert.equal(jobInput("shell", { text: "rm -rf" }), null);
});

test("problems in plain words, and waits that grow but stay short", () => {
  assert.equal(problemOf(0), "offline");
  assert.equal(problemOf(401), "signedOut");
  assert.equal(problemOf(413), "tooBig");
  assert.equal(problemOf(404), "notReady");
  assert.equal(problemOf(500), "server");
  assert.equal(retryAfter(1), 15_000);
  assert.equal(retryAfter(2), 30_000);
  assert.equal(retryAfter(20), 300_000);
});

test("connectors: push what changed here, pull what changed there, nothing when equal", () => {
  assert.equal(vaultAction("h1", undefined, null), "push");
  assert.equal(vaultAction("h1", { version: 3, hash: "h1" }, 3), "none");
  assert.equal(vaultAction("h1", { version: 3, hash: "h1" }, 4), "pull");
  assert.equal(vaultAction("h2", { version: 3, hash: "h1" }, 4), "push"); // both changed: push, the 409 merges
  assert.equal(vaultAction(null, undefined, 2), "pull"); // made on another computer
  assert.equal(vaultAction(null, { version: 2, hash: "h" }, 2), "none"); // removed here
  assert.equal(vaultAction("h1", { version: 3, hash: "h1" }, null), "push"); // the account lost it
});

test("connector merge keeps this computer's settings, the freshest sign-in, and no key is lost", () => {
  const local = { name: "Notion", transport: "http" as const, url: "https://x", headers: { A: "", B: "b-here" }, oauth: { tokens: { access_token: "old" }, signedInAt: 1 }, enabled: true, trusted: false };
  const remote = { name: "Notion2", transport: "http" as const, url: "https://x", headers: { A: "a-there", B: "b-there" }, oauth: { tokens: { access_token: "new" }, signedInAt: 2 }, enabled: false, trusted: true };
  const m = vaultMerge(local, remote);
  assert.equal(m.name, "Notion");
  assert.deepEqual(m.headers, { A: "a-there", B: "b-here" });
  assert.deepEqual(m.oauth?.tokens, { access_token: "new" });
});
