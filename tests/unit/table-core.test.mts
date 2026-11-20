// Tables the bots work on without reading them (lib/table-core.ts): a workbook's rows, a digest for the
// conversation, filters, and one action per row filled in from the row.
import test from "node:test";
import assert from "node:assert/strict";
import { fromSheetText, fromCsvText, digest, selectRows, planBatch, placeholdersOf, cellsText } from "../../lib/table-core.ts";

// A sheet as lib/attachments.ts stores it: a line of column letters, then "row number, cells…".
const SHEET = [
  "row,A,B,C,D",
  "1,Company,Email,City,Status",
  '2,"Dupont, Fils",contact@dupont.dz,Alger,New',
  "3,Garage Karim,,Oran,New",
  "4,Café Lina,lina@cafe.dz,Alger,Refused",
  "5,Hôtel Sud,CONTACT@dupont.dz,Oran,Interested",
].join("\n");

test("a stored sheet becomes a table: the first row is the header, quoted cells keep their commas", () => {
  const t = fromSheetText(SHEET);
  assert.deepEqual(t.columns, ["Company", "Email", "City", "Status"]);
  assert.equal(t.rows.length, 4);
  assert.deepEqual(t.rows[0], { n: 2, cells: ["Dupont, Fils", "contact@dupont.dz", "Alger", "New"] });
  assert.deepEqual(t.rows[1]!.cells, ["Garage Karim", "", "Oran", "New"]);
});

test("a CSV file becomes a table, whatever its separator", () => {
  const t = fromCsvText("Nom;Email\nAli;ali@x.dz\n\"Ben; Sara\";sara@x.dz\n");
  assert.deepEqual(t.columns, ["Nom", "Email"]);
  assert.deepEqual(t.rows.map((r) => r.cells), [["Ali", "ali@x.dz"], ["Ben; Sara", "sara@x.dz"]]);
  assert.equal(t.rows[0]!.n, 2);
});

test("the digest says what is in the table without the table: counts, short value lists, a few rows", () => {
  const d = digest(fromSheetText(SHEET), 2);
  assert.match(d, /4 rows, 4 columns/);
  assert.match(d, /Email: 3 of 4 filled/);
  assert.match(d, /City: 4 of 4 filled; values: Alger \(2\), Oran \(2\)/);
  assert.match(d, /Row 2: Company=Dupont, Fils · Email=contact@dupont\.dz/);
  assert.ok(!d.includes("lina@cafe.dz"), "rows beyond the sample stay out of the digest");
});

test("rows are chosen by filters on columns; column names forgive case and accents", () => {
  const t = fromSheetText(SHEET);
  const r = selectRows(t, { filter: [{ column: "city", op: "=", value: "alger" }] });
  assert.ok(!("error" in r));
  assert.deepEqual(r.rows.map((x) => x.n), [2, 4]);
  const notEmpty = selectRows(t, { filter: [{ column: "Email", op: "not_empty" }, { column: "Status", op: "!=", value: "Refused" }] });
  assert.ok(!("error" in notEmpty));
  assert.deepEqual(notEmpty.rows.map((x) => x.n), [2, 5]);
  const has = selectRows(t, { filter: [{ column: "Company", op: "contains", value: "hotel" }] });
  assert.ok(!("error" in has));
  assert.deepEqual(has.rows.map((x) => x.n), [5]);
  const oneOf = selectRows(t, { filter: [{ column: "Status", op: "in", value: ["New", "Interested"] }] });
  assert.ok(!("error" in oneOf));
  assert.equal(oneOf.rows.length, 3);
});

test("a filter on a column that doesn't exist is refused with the real column names", () => {
  const r = selectRows(fromSheetText(SHEET), { filter: [{ column: "Statut", op: "=", value: "New" }] });
  assert.ok("error" in r);
  assert.match(r.error, /Statut/);
  assert.match(r.error, /Company, Email, City, Status/);
});

test("rows come out as text with only the columns asked for, and say how many match", () => {
  const t = fromSheetText(SHEET);
  const r = selectRows(t, { columns: ["Company", "Email"], limit: 2 });
  assert.ok(!("error" in r));
  assert.equal(r.matching, 4);
  assert.equal(r.rows.length, 2);
  const text = cellsText(r.columns, r.rows);
  assert.match(text, /^row \| Company \| Email/);
  assert.match(text, /2 \| Dupont, Fils \| contact@dupont\.dz/);
  assert.ok(!text.includes("Alger"));
});

test("placeholders are found anywhere inside an action's input", () => {
  assert.deepEqual(placeholdersOf({ params: { to: "{Email}", body: "Hello {Company}, in {City}" }, n: 3, list: ["{Email}"] }).sort(), ["City", "Company", "Email"]);
});

test("one action per row: the input is filled from the row, rows missing a needed value are skipped", () => {
  const t = fromSheetText(SHEET);
  const p = planBatch(t, { input: { params: { to: "{Email}", subject: "Site for {Company}" } } });
  assert.ok(!("error" in p));
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items[0], { n: 2, input: { params: { to: "contact@dupont.dz", subject: "Site for Dupont, Fils" } } });
  assert.deepEqual(p.skipped, { empty: 1, duplicate: 0 });
  assert.deepEqual(p.emptyRows, [3]);
});

test("the same address is written to once: duplicates of unique_by are skipped, whatever the letter case", () => {
  const p = planBatch(fromSheetText(SHEET), { input: { to: "{Email}" }, uniqueBy: "Email" });
  assert.ok(!("error" in p));
  assert.deepEqual(p.items.map((i) => i.n), [2, 4]);
  assert.deepEqual(p.skipped, { empty: 1, duplicate: 1 });
});

test("a filter narrows the batch; a placeholder that names no column is refused before anything runs", () => {
  const t = fromSheetText(SHEET);
  const p = planBatch(t, { input: { to: "{Email}" }, filter: [{ column: "Status", op: "=", value: "New" }] });
  assert.ok(!("error" in p));
  assert.deepEqual(p.items.map((i) => i.n), [2]);
  const bad = planBatch(t, { input: { to: "{Mail}" } });
  assert.ok("error" in bad);
  assert.match(bad.error, /\{Mail\}/);
  assert.match(bad.error, /Company, Email, City, Status/);
});

test("an input with no placeholder at all is refused: it would do the same thing for every row", () => {
  const bad = planBatch(fromSheetText(SHEET), { input: { to: "someone@x.dz" } });
  assert.ok("error" in bad);
  assert.match(bad.error, /placeholder/);
});

test("values that were never in the row can't appear: a filled input only holds the row's own cells", () => {
  const p = planBatch(fromSheetText(SHEET), { input: { to: "{Email}" } });
  assert.ok(!("error" in p));
  const all = new Set(fromSheetText(SHEET).rows.map((r) => r.cells[1]));
  for (const i of p.items) assert.ok(all.has((i.input as { to: string }).to));
});

test("an attached workbook is shown to the bot as a digest per sheet; other files have none", async () => {
  const { segmentsDigest } = await import("../../lib/table-core.ts");
  const one = segmentsDigest("xlsx", [{ label: "Sheet: Leads", text: SHEET }]);
  assert.match(one!, /4 rows, 4 columns/);
  const two = segmentsDigest("xlsx", [{ label: "Sheet: A", text: SHEET }, { label: "Sheet: B", text: SHEET }]);
  assert.match(two!, /--- Sheet: A ---/);
  assert.match(two!, /--- Sheet: B ---/);
  assert.match(segmentsDigest("csv", [{ label: "Table", text: "Nom;Email\nAli;ali@x.dz\n" }])!, /1 rows, 2 columns/);
  assert.equal(segmentsDigest("pdf", [{ label: "Page 1", text: "hello" }]), null);
});

test("a batch says how many rows its filter leaves out, so the card can show it", () => {
  const t = fromSheetText(SHEET);
  const p = planBatch(t, { input: { to: "{Email}" }, filter: [{ column: "Status", op: "!=", value: "Refused" }] });
  assert.ok(!("error" in p));
  assert.equal(p.filteredOut, 1);
  const all = planBatch(t, { input: { to: "{Email}" } });
  assert.ok(!("error" in all));
  assert.equal(all.filteredOut, 0);
});
