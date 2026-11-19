import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, safeHref } from "../../web/app/m/_lib/markdown.ts";

test("inline: bold, italic, strike, code and links", () => {
  assert.deepEqual(parseInline("a **b** c"), [{ t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }]);
  assert.deepEqual(parseInline("*i* and _j_"), [{ t: "i", c: [{ t: "text", v: "i" }] }, { t: "text", v: " and " }, { t: "i", c: [{ t: "text", v: "j" }] }]);
  assert.deepEqual(parseInline("~~old~~"), [{ t: "s", c: [{ t: "text", v: "old" }] }]);
  assert.deepEqual(parseInline("run `npm i` now"), [{ t: "text", v: "run " }, { t: "code", v: "npm i" }, { t: "text", v: " now" }]);
  assert.deepEqual(parseInline("[Booking](https://booking.com/a?b=1)"), [{ t: "a", href: "https://booking.com/a?b=1", c: [{ t: "text", v: "Booking" }] }]);
});

test("inline: plain marks stay text (snake_case, 2 * 3, lone stars)", () => {
  assert.deepEqual(parseInline("file_name_here"), [{ t: "text", v: "file_name_here" }]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ t: "text", v: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("a ** b"), [{ t: "text", v: "a ** b" }]);
  assert.deepEqual(parseInline("\\*not\\*"), [{ t: "text", v: "*not*" }]);
});

test("links: only http(s), mailto and tel; javascript and data are dropped to text", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(safeHref("www.oovi.app"), "https://www.oovi.app");
  const bad = parseInline("[click](javascript:alert(1))");
  assert.ok(!JSON.stringify(bad).includes('"t":"a"'));
  assert.deepEqual(parseInline("see https://oovi.app/x."), [{ t: "text", v: "see " }, { t: "a", href: "https://oovi.app/x", c: [{ t: "text", v: "https://oovi.app/x" }] }, { t: "text", v: "." }]);
  assert.deepEqual(parseInline("رابط: https://oovi.app"), [{ t: "text", v: "رابط: " }, { t: "a", href: "https://oovi.app", c: [{ t: "text", v: "https://oovi.app" }] }]);
});

test("blocks: headings, lists, quotes, code, rules and paragraphs", () => {
  const b = parseMarkdown("# Hotels\n\nTwo options:\n\n- **Ibis** Oran\n- Sheraton\n\n3. third\n4. fourth\n\n> quoted *text*\n\n```js\nconst a = 1 < 2;\n```\n\n---\nend");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "quote", "code", "hr", "p"]);
  assert.equal((b[3] as { start?: number }).start, 3);
  assert.equal((b[5] as { v: string }).v, "const a = 1 < 2;");
  assert.equal((b[2] as { items: unknown[] }).items.length, 2);
});

test("tables with alignment, escaped pipes and short rows", () => {
  const b = parseMarkdown("| Name | Price | Note |\n|:--|--:|:-:|\n| Ibis | 9 000 DA | a \\| b |\n| Sheraton | 25 000 DA |");
  assert.equal(b.length, 1);
  const t = b[0] as { t: string; head: unknown[]; rows: { t: string; v: string }[][][]; align: unknown[] };
  assert.equal(t.t, "table");
  assert.deepEqual(t.align, ["l", "r", "c"]);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0]![2], [{ t: "text", v: "a | b" }]);
  assert.deepEqual(t.rows[1]![2], []);
});

test("Arabic text and line breaks inside a paragraph", () => {
  const b = parseMarkdown("مرحبا **صديقي**\nكيف حالك؟");
  assert.equal(b.length, 1);
  const p = b[0] as { c: { t: string }[] };
  assert.deepEqual(p.c.map((x) => x.t), ["text", "b", "br", "text"]);
});
