// Loop guard (lib/loop-guard-core.ts): repeated or repeatedly failing calls are refused, others run.
import test from "node:test";
import assert from "node:assert/strict";
import { callKey, callsSoFar, loopRefusal, MAX_SAME } from "../../lib/loop-guard-core.ts";

const call = (id: string, name: string, input: Record<string, unknown>) => ({ id, name, input });
const turn = (pairs: [ReturnType<typeof call>, boolean][]) =>
  pairs.flatMap(([c, failed]) => [
    { role: "assistant" as const, text: "", toolCalls: [c] },
    { role: "tool" as const, results: [{ id: c.id, name: c.name, content: failed ? "error" : "ok", ...(failed ? { isError: true } : {}) }] },
  ]);

test("the key ignores the order of the input's keys", () => {
  assert.equal(callKey({ name: "click", input: { a: 1, b: { c: 2, d: 3 } } }), callKey({ name: "click", input: { b: { d: 3, c: 2 }, a: 1 } }));
  assert.notEqual(callKey({ name: "click", input: { element: 1 } }), callKey({ name: "click", input: { element: 2 } }));
});

test("a call that failed twice the same way is refused the third time", () => {
  const c = call("x", "read_url", { url: "https://a.test" });
  const done = callsSoFar(turn([[{ ...c, id: "1" }, true], [{ ...c, id: "2" }, true]]));
  assert.match(loopRefusal(done, c) ?? "", /failed 2 times/);
  // A different input runs.
  assert.equal(loopRefusal(done, { name: "read_url", input: { url: "https://b.test" } }), null);
  // One failure, then a success in between: runs.
  const mixed = callsSoFar(turn([[{ ...c, id: "1" }, true], [{ ...c, id: "2" }, false]]));
  assert.equal(loopRefusal(mixed, c), null);
});

test("the same successful call many times in a row is refused; other calls in between reset the count", () => {
  const c = call("x", "work_table", { action: "read", table: "T" });
  const pairs: [ReturnType<typeof call>, boolean][] = Array.from({ length: MAX_SAME }, (_, i) => [{ ...c, id: String(i) }, false]);
  assert.match(loopRefusal(callsSoFar(turn(pairs)), c) ?? "", /already made this exact/);
  assert.equal(loopRefusal(callsSoFar(turn(pairs.slice(1))), c), null);
  const broken = [...pairs.slice(0, 2), [call("o", "web_search", { query: "q" }), false] as [ReturnType<typeof call>, boolean], ...pairs.slice(2)];
  assert.equal(loopRefusal(callsSoFar(turn(broken)), c), null);
});

test("scrolling and waiting may repeat", () => {
  const c = call("x", "scroll", { direction: "down" });
  const pairs: [ReturnType<typeof call>, boolean][] = Array.from({ length: 10 }, (_, i) => [{ ...c, id: String(i) }, false]);
  assert.equal(loopRefusal(callsSoFar(turn(pairs)), c), null);
});

test("a call with no result yet doesn't count", () => {
  const c = call("x", "read_url", { url: "u" });
  assert.deepEqual(callsSoFar([{ role: "assistant", text: "", toolCalls: [c] }]), []);
});

test("a file made again and again in one turn: the second time is allowed (a correction), the third is not", async () => {
  const { remadeRefusal } = await import("../../lib/loop-guard-core.ts");
  const make = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: "create_presentation", input: { filename: "Deck.pptx", title: `v${id}`, ...extra } });
  const turn = (n: number) => Array.from({ length: n }, (_, i) => [{ role: "assistant" as const, text: "", toolCalls: [make(String(i))] }, { role: "tool" as const, results: [{ id: String(i), name: "create_presentation", content: "Created" }] }]).flat();
  assert.equal(remadeRefusal(turn(0), make("a")), null);
  assert.equal(remadeRefusal(turn(1), make("a")), null);
  assert.match(remadeRefusal(turn(2), make("a"))!, /already made "Deck\.pptx" 2 times in this turn/);
  // Another file, or adding to a document (append), is not a remake.
  assert.equal(remadeRefusal(turn(2), { id: "x", name: "create_presentation", input: { filename: "Other.pptx" } }), null);
  assert.equal(remadeRefusal(turn(2), { id: "x", name: "create_document", input: { filename: "Deck.pptx", append: true } }), null);
  // A try that failed doesn't count.
  const failed = [{ role: "assistant" as const, text: "", toolCalls: [make("0")] }, { role: "tool" as const, results: [{ id: "0", name: "create_presentation", content: "bad", isError: true }] }, ...turn(1)];
  assert.equal(remadeRefusal(failed, make("a")), null);
});
