import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyEdit, CANVAS_CHART_KINDS, CANVAS_PALETTE, chartData, HISTORY_GAP_MS, makeChart, numericColumns, parseNumber, restoreSnapshot, snapshotsFor } from "../../lib/canvas-core.ts";

const store = () => ({
  tables: { Sales: { columns: ["Month", "Revenue", "Costs", "Note"], rows: [["Jan", "1 200,50", "800", "ok"], ["Feb", "$1,500", "900", ""], ["Mar", "2k", "(100)", "promo"]], updatedAt: 1 } },
  notes: { Plan: { text: "# Plan\n- step 1", updatedAt: 1 } },
}) as never as Parameters<typeof applyEdit>[0];

test("numbers are read the way people write them", () => {
  const cases: [string, number | null][] = [["1 200,50", 1200.5], ["1,200.50", 1200.5], ["1.200,50", 1200.5], ["12 %", 12], ["$3.5k", 3500], ["2M", 2e6], ["(40)", -40], ["-7", -7], ["1,5", 1.5], ["1,200", 1200], ["3 500 DA", 3500], ["abc", null], ["", null], ["2024-01-05", null]];
  for (const [s, n] of cases) assert.equal(parseNumber(s), n, s);
});

test("a chart is drawn from a table's number columns and follows edits", () => {
  const s = store();
  assert.deepEqual(numericColumns(s.tables.Sales!), ["Revenue", "Costs"]);
  assert.equal(applyEdit(s, { op: "chart", table: "Sales", type: "line", x: "Month", y: ["Revenue", "Costs"], title: "Sales 2026" }), null);
  const c = s.charts!["Sales 2026"]!;
  let d = chartData(s.tables.Sales, c);
  assert.deepEqual(d.categories, ["Jan", "Feb", "Mar"]);
  assert.deepEqual(d.series[0], { name: "Revenue", values: [1200.5, 1500, 2000] });
  assert.deepEqual(d.series[1]!.values, [800, 900, -100]);
  applyEdit(s, { op: "cell", table: "Sales", row: 0, col: 1, value: "3000" });
  d = chartData(s.tables.Sales, c);
  assert.equal(d.series[0]!.values[0], 3000, "the chart follows the edit");
  applyEdit(s, { op: "renameColumn", table: "Sales", col: 1, name: "Income" });
  assert.deepEqual(s.charts!["Sales 2026"]!.y, ["Income", "Costs"], "the chart follows a renamed column");
});

test("a chart that can't be drawn says why, with the columns that could", () => {
  const s = store();
  assert.match(makeChart(s, { table: "Sales", y: ["Note"] }) as string, /don't hold numbers.*Revenue, Costs/);
  assert.match(makeChart(s, { table: "Nope" }) as string, /no table/);
  assert.match(makeChart(s, { table: "Sales", type: "radar" }) as string, /one of/);
});

test("edits by hand: cells, rows, columns, pages", () => {
  const s = store();
  assert.equal(applyEdit(s, { op: "addRow", table: "Sales" }), null);
  assert.equal(s.tables.Sales!.rows.length, 4);
  assert.equal(applyEdit(s, { op: "cell", table: "Sales", row: 3, col: 0, value: "Apr" }), null);
  assert.equal(applyEdit(s, { op: "cell", table: "Sales", row: 9, col: 0, value: "x" }), "That cell isn't there any more.");
  assert.equal(applyEdit(s, { op: "addColumn", table: "Sales", name: "Region" }), null);
  assert.ok(s.tables.Sales!.rows.every((r) => r.length === 5));
  assert.match(applyEdit(s, { op: "addColumn", table: "Sales", name: "region" })!, /already/);
  assert.equal(applyEdit(s, { op: "removeRow", table: "Sales", row: 0 }), null);
  assert.equal(s.tables.Sales!.rows[0]![0], "Feb");
  assert.equal(applyEdit(s, { op: "newNote", name: "Ideas" }), null);
  assert.match(applyEdit(s, { op: "newTable", name: "Plan", columns: [] })!, /already/);
  assert.equal(applyEdit(s, { op: "note", name: "Ideas", text: "hello" }), null);
  assert.equal(applyEdit(s, { op: "rename", kind: "table", name: "Sales", to: "Sales 2026" }), null);
  assert.ok(s.tables["Sales 2026"] && !s.tables.Sales);
  assert.equal(applyEdit(s, { op: "newNote", name: "../../etc/passwd" }), null);
  assert.ok(!Object.keys(s.notes).some((k) => /[/\\]/.test(k)), "names can't hold path characters");
});

test("deleting a table deletes its charts", () => {
  const s = store();
  applyEdit(s, { op: "chart", table: "Sales", type: "column", x: "Month", y: ["Revenue"], title: "R" });
  applyEdit(s, { op: "delete", kind: "table", name: "Sales" });
  assert.deepEqual(s.charts, {});
});

test("history: one earlier version per burst of edits, restore brings it back", () => {
  const before = store();
  const after = store();
  applyEdit(after, { op: "cell", table: "Sales", row: 0, col: 0, value: "January" }, 1000);
  let h = snapshotsFor([], before, after, 1000, () => "a");
  assert.equal(h.length, 1);
  assert.equal(h[0]!.name, "Sales");
  // another edit a moment later: no second version
  const after2 = JSON.parse(JSON.stringify(after));
  applyEdit(after2, { op: "cell", table: "Sales", row: 1, col: 0, value: "February" }, 2000);
  h = snapshotsFor(h, after, after2, 2000, () => "b");
  assert.equal(h.length, 1);
  // later: a new one
  const after3 = JSON.parse(JSON.stringify(after2));
  applyEdit(after3, { op: "note", name: "Plan", text: "changed" }, HISTORY_GAP_MS + 5000);
  applyEdit(after3, { op: "cell", table: "Sales", row: 2, col: 0, value: "March" }, HISTORY_GAP_MS + 5000);
  h = snapshotsFor(h, after2, after3, HISTORY_GAP_MS + 5000, () => "c" + Math.random());
  assert.equal(h.length, 3);
  restoreSnapshot(after3, h[0]!, 99);
  assert.equal(after3.tables.Sales!.rows[0]![0], "Jan", "the first version is back");
  // a deleted page can be brought back
  const gone = JSON.parse(JSON.stringify(before));
  applyEdit(gone, { op: "delete", kind: "note", name: "Plan" });
  const hg = snapshotsFor([], before, gone, 5, () => "d");
  assert.ok(hg.some((x) => x.kind === "note" && x.name === "Plan"));
});

test("the copies of constants match their sources", () => {
  const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const charts = read("lib/charts.ts");
  assert.ok(charts.includes(`export const CHART_KINDS: readonly ChartKind[] = ${JSON.stringify(CANVAS_CHART_KINDS).replace(/,/g, ", ")};`));
  assert.ok(charts.includes(`export const PALETTE = ${JSON.stringify(CANVAS_PALETTE).replace(/,/g, ", ")};`));
  const wf = read("lib/workfiles-core.ts");
  for (const line of ["export const MAX_ROWS = 20_000;", "export const MAX_COLUMNS = 40;", "export const MAX_CELL = 2_000;"]) assert.ok(wf.includes(line), line);
});
