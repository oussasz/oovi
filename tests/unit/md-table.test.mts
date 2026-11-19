import { test } from "node:test";
import assert from "node:assert/strict";
import { cellsOf, splitTables } from "../../lib/md-table-core.ts";

test("a Markdown table in a message becomes a table, the text around it stays text", () => {
  const s = splitTables("I found 3 hotels:\n\n| Hotel | Price | Rating |\n| --- | ---: | :-: |\n| Ibis Oran | 9,800 DA | 4.1 |\n| Royal | 11,900 DA | 4.6 |\n\nThe cheapest is **Ibis**.");
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { kind: "text", text: "I found 3 hotels:" });
  assert.equal(s[1]!.kind, "table");
  if (s[1]!.kind === "table") {
    assert.deepEqual(s[1].header, ["Hotel", "Price", "Rating"]);
    assert.deepEqual(s[1].align, [null, "right", "center"]);
    assert.deepEqual(s[1].rows, [["Ibis Oran", "9,800 DA", "4.1"], ["Royal", "11,900 DA", "4.6"]]);
  }
  assert.deepEqual(s[2], { kind: "text", text: "The cheapest is **Ibis**." });
});

test("no separator line, a pipe in a sentence or inside code: not a table", () => {
  assert.deepEqual(splitTables("a | b\nc | d"), [{ kind: "text", text: "a | b\nc | d" }]);
  assert.equal(splitTables("Use `a | b` here").length, 1);
  assert.equal(splitTables("```\n| a | b |\n| - | - |\n```")[0]!.kind, "text");
});

test("tables without outer pipes, Arabic, short rows and escaped pipes", () => {
  const s = splitTables("الاسم | الهاتف\n--- | ---\nكريم | 0555 11 22 33\nسارة");
  assert.equal(s[0]!.kind, "table");
  if (s[0]!.kind === "table") assert.deepEqual(s[0].rows, [["كريم", "0555 11 22 33"]]);
  assert.deepEqual(cellsOf("| a \\| b | c |"), ["a | b", "c"]);
});
