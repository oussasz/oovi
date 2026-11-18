import { test } from "node:test";
import assert from "node:assert/strict";
import { chatMarkdown, findInChat, fold, forkChat, quoteOf, replyNote, searchChats, snippetAround } from "../../lib/chat-basics-core.ts";

const bot = (id: string, text: string, at: number, extra: Record<string, unknown> = {}) => ({ id, kind: "bot", botId: "b1", at, steps: [], text, status: "done", usage: { input: 0, output: 0 }, ...extra });
const user = (id: string, text: string, at: number, extra: Record<string, unknown> = {}) => ({ id, kind: "user", text, at, ...extra });
const chat = (id: string, entries: unknown[], extra: Record<string, unknown> = {}) => ({ id, kind: "direct", name: "", memberIds: ["b1"], leadId: "b1", createdAt: 1, updatedAt: 1, entries, ...extra }) as never;
const names = (id: string) => (id === "b1" ? "Scout" : "Bot");

test("fold: case, accents, Arabic marks and letter forms", () => {
  assert.equal(fold("Café ÉLÈVE"), "cafe eleve");
  assert.equal(fold("مَدْرَسَة"), fold("مدرسه"));
  assert.equal(fold("إسلام"), fold("اسلام"));
});

test("search: every word, any order, newest first, skips relayed tasks", () => {
  const a = chat("dm-b1", [user("u1", "Find cafés in Oran please", 10), bot("e1", "Here are 20 cafes in Oran", 20), user("u2", "cafe oran", 30, { via: "b9" })]);
  const b = chat("g1", [user("u3", "قهوة في وهران و oran café", 40)], { kind: "group", name: "Team" });
  const hits = searchChats([a, b], "oran CAFE", names);
  assert.deepEqual(hits.map((h) => h.entryId), ["u3", "e1", "u1"]);
  assert.equal(hits[1]!.who, "Scout");
  assert.equal(hits[2]!.who, "You");
  assert.deepEqual(searchChats([a], "x", names), []);
  assert.deepEqual(searchChats([a], "   ", names), []);
});

test("snippet keeps the match in view on word edges", () => {
  const long = `${"word ".repeat(60)}the price of olive oil is 900 DA ${"more ".repeat(60)}`;
  const s = snippetAround(long, "olive", 80);
  assert.ok(s.includes("olive"));
  assert.ok(s.startsWith("…") && s.endsWith("…"));
  assert.ok(s.length < 90);
});

test("find in chat: ids oldest first", () => {
  const c = chat("dm-b1", [user("u1", "Hello Oran", 1), bot("e1", "nothing", 2), bot("e2", "ORAN again", 3)]);
  assert.deepEqual(findInChat(c, "oran"), ["u1", "e2"]);
});

test("fork: up to the message, waiting states closed, summary kept only when inside", () => {
  const c = chat("dm-b1", [user("u1", "a", 1), bot("e1", "b", 2, { status: "waiting", questions: { state: "waiting", items: [] } }), user("u2", "c", 3)], { summary: { upTo: "e1", text: "S" }, pending: { queue: [] }, workspace: { path: "/x", autoEdit: false } });
  const f = forkChat(c, "e1", "new1", 99, "Scout · copy");
  assert.ok(typeof f !== "string");
  assert.deepEqual(f.entries.map((e) => e.id), ["u1", "e1"]);
  assert.equal((f.entries[1] as { status: string }).status, "stopped");
  assert.equal((f.entries[1] as { questions?: unknown }).questions, undefined);
  assert.equal(f.summary?.text, "S");
  assert.equal((f as { pending?: unknown }).pending, undefined);
  assert.deepEqual(f.forkOf, { chatId: "dm-b1", entryId: "e1" });
  assert.equal((c as { entries: { status?: string }[] }).entries[1]!.status, "waiting", "the original is untouched");
  const g = forkChat(c, "u1", "new2", 99, "x");
  assert.ok(typeof g !== "string" && !g.summary);
  assert.equal(typeof forkChat(c, "nope", "n", 1, "x"), "string");
});

test("markdown export: messages, quotes and files, no inner steps", () => {
  const c = chat("dm-b1", [
    user("u1", "Make the list", 0, { attachments: [{ id: "a", name: "brief.pdf" }] }),
    bot("e1", "Done: **20 rows**", 60_000, { steps: [{ role: "tool", results: [{ id: "t", name: "work_export", content: "secret inner text", file: { path: "/p", name: "Leads.xlsx", size: 1 } }] }] }),
    user("u2", "thanks", 120_000, { replyTo: { id: "e1", who: "Scout", text: "Done: **20 rows**" } }),
  ]);
  const md = chatMarkdown(c, "Scout", names);
  assert.match(md, /^# Scout/);
  assert.match(md, /## You · 1970-01-01 00:00/);
  assert.match(md, /📎 brief\.pdf/);
  assert.match(md, /## Scout · 1970-01-01 00:01\n\nDone: \*\*20 rows\*\*/);
  assert.match(md, /📄 Leads\.xlsx/);
  assert.match(md, /> Scout: Done/);
  assert.doesNotMatch(md, /secret inner text/);
});

test("reply quote: one line, short, says who", () => {
  const q = quoteOf(bot("e1", `line one\nline two ${"x".repeat(400)}`, 1) as never, names);
  assert.equal(q.who, "Scout");
  assert.ok(q.text.length <= 300 && !q.text.includes("\n"));
  assert.match(replyNote(q), /^\[Replying to Scout's message: "line one line two/);
  assert.match(replyNote({ who: "You", text: "hi" }), /the user's own earlier message/);
});
