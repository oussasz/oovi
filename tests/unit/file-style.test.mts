// The look of exported files (lib/file-style.ts): which columns are numbers, what stays text, formats, widths.
import test from "node:test";
import assert from "node:assert/strict";
import { coerceRows, columnLetter, columnLooks, fileTheme, FILE_THEMES, isUrl, mostlyRtl, percentNumber, plainNumber } from "../../lib/file-style.ts";

test("numbers typed as text become numbers; phones, codes and leading zeros stay text", () => {
  assert.equal(plainNumber("1,200"), 1200);
  assert.equal(plainNumber("3.5"), 3.5);
  assert.equal(plainNumber("-42"), -42);
  assert.equal(plainNumber("0555123456"), null);
  assert.equal(plainNumber("007"), null);
  assert.equal(plainNumber("+213770112233"), null);
  assert.equal(plainNumber("213770112233"), null);
  assert.equal(plainNumber("12 rue Didouche"), null);
  assert.equal(plainNumber("1,2,3"), null);
  assert.equal(plainNumber("0.75"), 0.75);
  assert.equal(percentNumber("12%"), 0.12);
  assert.equal(percentNumber("-3,5 %"), -0.035);
  assert.equal(percentNumber("12"), null);
});

test("a column is a number only when every filled cell is one", () => {
  const cols = ["Name", "Phone", "Revenue", "Growth", "Year", "Rating", "Mixed", "Postal code"];
  const rows = [
    ["A", "0555123456", "4250000", "12%", "2019", 4.6, "12", "16000"],
    ["B", "021634455", "2,980,000", "8%", "1890", 4.25, "n/a", "31000"],
    ["C", "", "=SUM(C2:C3)", "", "2005", null, "7", "25000"],
  ];
  const looks = columnLooks(cols, rows);
  assert.deepEqual(
    looks.map((l) => l.kind),
    ["text", "text", "number", "percent", "number", "number", "text", "text"],
  );
  assert.equal(looks[2]!.format, "#,##0");
  assert.equal(looks[3]!.format, "0%");
  assert.equal(looks[4]!.format, "", "years get no thousands separator");
  assert.equal(looks[5]!.format, "0.00");
  assert.equal(looks[7]!.coerce, false, "a code column is never turned into numbers");
  const out = coerceRows(rows, looks);
  assert.equal(out[0]![2], 4250000);
  assert.equal(out[1]![2], 2980000);
  assert.equal(out[2]![2], "=SUM(C2:C3)", "formulas are kept");
  assert.equal(out[0]![3], 0.12);
  assert.equal(out[0]![4], 2019);
  assert.equal(out[0]![1], "0555123456");
  assert.equal(out[0]![6], "12", "a mixed column stays as typed");
  assert.equal(out[0]![7], "16000");
});

test("a format the bot gave wins; widths stay within bounds; long text wraps", () => {
  const looks = columnLooks(["Price", "Notes", "X"], [[1200.5, "a".repeat(200), "y"]], ['#,##0.00 "DA"']);
  assert.equal(looks[0]!.format, '#,##0.00 "DA"');
  assert.equal(looks[1]!.width, 60);
  assert.equal(looks[1]!.wrap, true);
  assert.equal(looks[2]!.width, 10);
  assert.equal(columnLooks([], []).length, 0);
});

test("right-to-left text, links, column letters and themes", () => {
  assert.equal(mostlyRtl("دراسة السوق: الربع الأول"), true);
  assert.equal(mostlyRtl("Market study 2026"), false);
  assert.equal(mostlyRtl("Rapport pour شركة"), false);
  assert.equal(mostlyRtl("12,500"), false);
  assert.equal(isUrl("https://example.com/a?b=1"), true);
  assert.equal(isUrl("see https://example.com"), false);
  assert.equal(isUrl("javascript:alert(1)"), false);
  assert.equal(columnLetter(1), "A");
  assert.equal(columnLetter(26), "Z");
  assert.equal(columnLetter(27), "AA");
  assert.equal(columnLetter(703), "AAA");
  assert.equal(fileTheme("green"), FILE_THEMES.green);
  assert.equal(fileTheme("nope"), FILE_THEMES.blue);
  assert.equal(fileTheme(undefined), FILE_THEMES.blue);
  for (const t of Object.values(FILE_THEMES)) for (const c of Object.values(t)) assert.match(c, /^[0-9A-F]{6}$/);
});
