import { test } from "node:test";
import assert from "node:assert/strict";
import { addRows, countComplete, emptyStore, progressMark, readRows, removeRows, storeLines, tableMarkdown, updateRow, writeNote, MAX_FILES } from "../../lib/workfiles-core.ts";

const COLS = ["Name", "Type", "Area", "Phone", "Source"];

test("three bots fill one table: rows add up and the count is known", () => {
  const s = emptyStore();
  let r = addRows(s, "Prospects Alger", COLS, [["Salon Cléopâtre", "Salon", "Hussein Dey", "+213 555 199 669", "site"], ["Café Chergui", "Café", "Hydra", "", "dzadvisor"]]);
  assert.deepEqual([r.added, r.merged, r.skipped, r.total], [2, 0, 0, 2]);
  r = addRows(s, "Prospects Alger", undefined, [{ name: "El Hyl Coffee", phone: "+213 551 33 65 20", source: "facebook" }]);
  assert.deepEqual([r.added, r.total], [1, 3]);
  assert.equal(countComplete(s.tables["Prospects Alger"], ["Phone"]), 2);
  assert.equal(countComplete(s.tables["Prospects Alger"], []), 3);
  assert.match(storeLines(s)[0]!, /table "Prospects Alger": 3 rows.*Phone filled in 2/);
});

test("the same business isn't added twice: it is completed instead", () => {
  const s = emptyStore();
  addRows(s, "P", COLS, [["Café Chergui", "Café", "Hydra", "", "dzadvisor"]]);
  // Found again by another bot, this time with the number (and written differently).
  let r = addRows(s, "P", undefined, [["café  chergui", "", "", "0555 12 34 56", ""]]);
  assert.deepEqual([r.added, r.merged, r.total], [0, 1, 1]);
  assert.deepEqual(s.tables.P!.rows[0], ["Café Chergui", "Café", "Hydra", "0555 12 34 56", "dzadvisor"]);
  // Same phone under another name and format: still the same business.
  r = addRows(s, "P", undefined, [["Chergui Coffee Shop", "Café", "Hydra", "+213555123456", "x"]]);
  assert.deepEqual([r.added, r.skipped, r.total], [0, 1, 1]);
  // Nothing new at all: skipped.
  r = addRows(s, "P", undefined, [["Café Chergui", "Café", "Hydra", "", ""]]);
  assert.deepEqual([r.added, r.merged, r.skipped], [0, 0, 1]);
});

test("two shops that share a name but have different numbers are both kept", () => {
  const s = emptyStore();
  addRows(s, "P", COLS, [["Café Central", "Café", "Hydra", "0555 11 11 11", "a"]]);
  const r = addRows(s, "P", undefined, [["Café Central", "Café", "Kouba", "0555 22 22 22", "b"]]);
  assert.deepEqual([r.added, r.total], [1, 2]);
});

test("'à vérifier', '-', 'n/a' count as empty, not as a phone number", () => {
  const s = emptyStore();
  addRows(s, "P", COLS, [["A", "", "", "à vérifier", ""], ["B", "", "", "-", ""], ["C", "", "", "N/A", ""], ["D", "", "", "0550 25 59 49", ""]]);
  assert.equal(countComplete(s.tables.P, ["Phone"]), 1);
  // A later real number replaces the placeholder.
  const r = addRows(s, "P", undefined, [{ Name: "A", Phone: "021 44 92 17" }]);
  assert.equal(r.merged, 1);
  assert.equal(s.tables.P!.rows[0]![3], "021 44 92 17");
  assert.match(readRows(s.tables.P!, 1, 100, "phone").text, /2\. B/);
  assert.equal(readRows(s.tables.P!, 1, 100, "phone").matching, 2);
});

test("bad input is refused with a clear reason, and empty rows are skipped", () => {
  const s = emptyStore();
  assert.match(addRows(s, "", COLS, [["a"]]).error!, /name/);
  assert.match(addRows(s, "P", COLS, []).error!, /at least one row/);
  assert.match(addRows(s, "P", undefined, [["a", "b"]]).error!, /columns/);
  const r = addRows(s, "P", COLS, [["", "", "", "", ""], "junk", null, ["Real", "", "", "", ""]]);
  assert.deepEqual([r.added, r.skipped], [1, 3]);
  assert.equal(s.tables["../../etc"], undefined);
  addRows(s, "../../etc/passwd", ["a"], [["x"]]);
  assert.deepEqual(Object.keys(s.tables).sort(), ["P", "etc passwd"]); // a name, never a path
});

test("update, remove, notes, progress and export text", () => {
  const s = emptyStore();
  addRows(s, "P", COLS, [["A", "", "", "", ""], ["B", "", "", "", ""], ["C", "", "", "", ""]]);
  const before = progressMark(s);
  assert.equal(updateRow(s.tables.P!, 2, { phone: "0555 00 00 01" }), null);
  assert.ok(progressMark(s) > before); // filling a cell is progress
  assert.match(updateRow(s.tables.P!, 9, { phone: "x" })!, /doesn't exist/);
  // A column that isn't there yet (a Status) is added; the other rows get an empty cell.
  assert.equal(updateRow(s.tables.P!, 1, { Status: "checked" }), null);
  assert.equal(s.tables.P!.columns.at(-1), "Status");
  assert.deepEqual(s.tables.P!.rows.map((r) => [r.length, r.at(-1)]), [[COLS.length + 1, "checked"], [COLS.length + 1, ""], [COLS.length + 1, ""]]);
  assert.equal(removeRows(s.tables.P!, [1, 3, 99]), 2);
  assert.deepEqual(s.tables.P!.rows.map((r) => r[0]), ["B"]);
  assert.equal(writeNote(s, "Study", "# Part 1", false).size, 8);
  assert.equal(writeNote(s, "Study", "More | text", true).size, 21);
  assert.match(writeNote(s, "Study", "  ", true).error!, /empty/);
  assert.match(tableMarkdown("P", s.tables.P!), /\| B \|  \|  \| 0555 00 00 01 \|  \|/);
  const mark = progressMark(s);
  addRows(s, "P", undefined, [["B", "", "", "", ""]]);
  assert.equal(progressMark(s), mark); // a duplicate with nothing new is not progress
});

test("a chat can't grow an endless number of work files", () => {
  const s = emptyStore();
  for (let i = 0; i < MAX_FILES; i++) assert.equal(addRows(s, `T${i}`, ["a"], [["x"]]).error, undefined);
  assert.match(addRows(s, "one more", ["a"], [["x"]]).error!, /already has/);
  assert.match(writeNote(s, "note", "x", false).error!, /already has/);
});
