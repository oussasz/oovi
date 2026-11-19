import { test } from "node:test";
import assert from "node:assert/strict";
import { cellAlign, cellsOf, splitTables, tableDir } from "../../lib/md-table-core.ts";

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

test("column order follows the table's language, not the app's; alignment follows the column order", () => {
  const ar = splitTables("| الفندق | السعر |\n| --- | ---: |\n| Ibis | 9 800 دج |")[0]!;
  const en = splitTables("| Hotel | Price |\n| :-- | --: |\n| فندق الأندلس | 11,200 DA |")[0]!;
  assert.ok(ar.kind === "table" && en.kind === "table");
  if (ar.kind === "table") assert.equal(tableDir(ar), "rtl");
  if (en.kind === "table") assert.equal(tableDir(en), "ltr");
  assert.equal(tableDir({ header: ["", "#"], rows: [["كريم", "1"]] }), "rtl");
  assert.equal(tableDir({ header: ["Lien", "https://exemple.dz/مثال"], rows: [] }), "ltr");
  assert.equal(tableDir({ header: ["1", "2"], rows: [["3", "4"]] }), "ltr");
  assert.deepEqual(["left", "right", "center", null].map((a) => cellAlign(a as "left" | "right" | "center" | null)), ["start", "end", "center", undefined]);
});

test("a table never carries HTML: tags in cells stay as plain cell text", () => {
  const s = splitTables("| a | b |\n| - | - |\n| <img src=x onerror=alert(1)> | <b>x</b> |")[0]!;
  assert.ok(s.kind === "table");
  if (s.kind === "table") assert.deepEqual(s.rows[0], ["<img src=x onerror=alert(1)>", "<b>x</b>"]);
});
