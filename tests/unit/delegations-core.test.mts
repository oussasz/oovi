import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTaskState, healInterrupted, plainText, INTERRUPTED } from "../../lib/delegations-core.ts";
import { approvalCommand, planAnswer, yesNo } from "../../lib/telegram-links.ts";

const u = (id: string, text = "task") => ({ id, kind: "user", text, at: 1 });
const b = (id: string, botId: string, status: string, text = "", extra: Record<string, unknown> = {}) => ({ id, kind: "bot", botId, at: 2, steps: [], text, status, usage: { input: 0, output: 0 }, ...extra });
const chat = (entries: unknown[], pending?: unknown) => ({ id: "g1", kind: "group", name: "Studio", memberIds: ["a", "b"], createdAt: 0, updatedAt: 0, entries, ...(pending ? { pending } : {}) }) as never;

test("final answer is the last bot message of the task", () => {
  const c = chat([u("old"), b("x", "a", "done", "old answer"), u("t1"), b("e1", "a", "done", "@B do it"), b("e2", "b", "done", "did it"), b("e3", "a", "done", "Final: all good")]);
  assert.deepEqual(groupTaskState(c, "t1", false), { kind: "done", botId: "a", text: "Final: all good" });
  assert.deepEqual(groupTaskState(c, "t1", true), { kind: "running" });
});

test("a pause for the user's OK is reported as such, with a stable key", () => {
  const approval = { entryId: "e2", botId: "b", items: [{ call: { id: "c1", name: "save_skill", input: {} }, summary: "Save a skill", detail: "x" }], at: 42 };
  const c = chat([u("t1"), b("e1", "a", "done", "@B save"), b("e2", "b", "waiting")], { queue: [], turnsLeft: 3, approval });
  const s = groupTaskState(c, "t1", false);
  assert.equal(s.kind, "approval");
  assert.equal((s as { key: string }).key, "approval:e2:42");
  // An approval belonging to an older task doesn't count for this one.
  const c2 = chat([u("t0"), b("e0", "a", "waiting"), u("t1"), b("e1", "a", "done", "ok")], { queue: [], turnsLeft: 3, approval: { ...approval, entryId: "e0" } });
  assert.equal(groupTaskState(c2, "t0", false).kind, "superseded");
});

test("a proposed plan is not taken for an answer", () => {
  const c = chat([u("t1"), b("e1", "a", "waiting", "Compare apps", { plan: [{ text: "Search", status: "pending" }], planReview: "waiting" })], { queue: [], turnsLeft: 3, planReview: { entryId: "e1", botId: "a" } });
  assert.deepEqual(groupTaskState(c, "t1", false), { kind: "plan", key: "plan:e1", botId: "a", goal: "Compare apps", steps: ["Search"] });
  const cancelled = chat([u("t1"), b("e1", "a", "done", "Compare apps", { planReview: "cancelled" })]);
  assert.deepEqual(groupTaskState(cancelled, "t1", false), { kind: "cancelled" });
});

test("stops, errors, crashes and removed tasks", () => {
  const stopped = chat([u("t1"), b("e1", "b", "done", "half the research"), b("e2", "a", "stopped")]);
  assert.deepEqual(groupTaskState(stopped, "t1", false), { kind: "stopped", botId: "a", partial: "half the research" });
  const failed = chat([u("t1"), b("e1", "b", "done", "notes"), b("e2", "a", "error", "", { error: "rate limited" })]);
  assert.deepEqual(groupTaskState(failed, "t1", false), { kind: "error", botId: "a", error: "rate limited", partial: "notes" });
  const crashed = chat([u("t1"), b("e1", "a", "running")]);
  assert.deepEqual(groupTaskState(crashed, "t1", false), { kind: "error", botId: "a", error: INTERRUPTED, partial: undefined });
  assert.deepEqual(groupTaskState(chat([u("t1")]), "t1", false), { kind: "empty" });
  assert.deepEqual(groupTaskState(chat([]), "t1", false), { kind: "gone" });
});

test("healing chats left mid-run keeps real waits", () => {
  const c = chat([u("t1"), b("e1", "a", "running"), b("e2", "b", "waiting")], { queue: ["b"], turnsLeft: 2, approval: { entryId: "e2", botId: "b", items: [], at: 1 } }) as { entries: { status: string; error?: string }[]; pending?: unknown };
  assert.equal(healInterrupted(c as never), true);
  assert.equal(c.entries[1]!.status, "error");
  assert.equal(c.entries[1]!.error, INTERRUPTED);
  assert.equal(c.entries[2]!.status, "waiting");
  assert.ok(c.pending);
  const q = chat([u("t1"), b("e1", "a", "done", "x")], { queue: ["b"], turnsLeft: 2 }) as { pending?: unknown };
  assert.equal(healInterrupted(q as never), true);
  assert.equal(q.pending, undefined);
  assert.equal(healInterrupted(chat([u("t1"), b("e1", "a", "done", "x")])), false);
});

test("plain text for Telegram", () => {
  assert.equal(plainText("**Studio** finished. See [the page](https://x.test/a) and `index.html`.\n## Notes"), "Studio finished. See the page (https://x.test/a) and index.html.\nNotes");
});

test("plain yes/no words count only while something waits", () => {
  for (const w of ["yes", "OK", "نعم", "ايه", "oui.", "👍", "evet"]) assert.equal(yesNo(w), true, w);
  for (const w of ["no", "لا", "non!", "nein"]) assert.equal(yesNo(w), false, w);
  for (const w of ["ok thanks a lot", "yes but change step 2", "ماشي", "hello"]) assert.equal(yesNo(w), null, w);
  const pending = { items: [{ call: { id: "c1" } }, { call: { id: "c2" } }] };
  assert.deepEqual(approvalCommand("نعم", pending, true), { kind: "decide", input: { decisions: { c1: true, c2: true } }, word: true });
  assert.deepEqual(approvalCommand("no", pending, true), { kind: "decide", input: { decisions: { c1: false, c2: false } }, word: true });
  // Not shown in this chat: a plain word is just a message; only /yes decides.
  assert.deepEqual(approvalCommand("ok", pending), { kind: "none" });
  assert.deepEqual(approvalCommand("/yes", pending), { kind: "decide", input: { decisions: { c1: true, c2: true } } });
  assert.deepEqual(approvalCommand("ok", undefined, true), { kind: "none" }); // a normal message
  assert.deepEqual(approvalCommand("/yes", undefined), { kind: "nothing-pending" });
  assert.deepEqual(approvalCommand("/yes always", { items: [{ call: { id: "c1" }, folder: "D:/x" }] }), { kind: "decide", input: { decisions: { c1: true }, alwaysFolders: true, alwaysEdit: false } });
  assert.equal(planAnswer("/no"), false);
  assert.equal(planAnswer("ok", true), true);
  assert.equal(planAnswer("ok"), null);
  assert.equal(planAnswer("add museums", true), null);
});
