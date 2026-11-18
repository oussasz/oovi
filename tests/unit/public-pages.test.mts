// Shared pages (web/lib/public-pages-core.ts): what the app sends is checked, and every page is built as safe HTML.
import test from "node:test";
import assert from "node:assert/strict";
import { inline, notesHtml, pageHtml, tableHtml, validatePage } from "../../web/lib/public-pages-core.ts";

test("validate: notes and tables only, sizes kept, title required", () => {
  assert.equal(typeof validatePage({ title: "", content: { kind: "notes", text: "x" } }), "string");
  assert.equal(typeof validatePage({ title: "T", content: { kind: "html", text: "<b>" } }), "string");
  assert.equal(typeof validatePage({ title: "T", content: { kind: "notes", text: "   " } }), "string");
  const t = validatePage({ title: "  Leads \n Oran ", content: { kind: "table", columns: ["Name", "Phone"], rows: [["A", "1", "extra"], "bad"] } });
  assert.deepEqual(t, { title: "Leads Oran", content: { kind: "table", columns: ["Name", "Phone"], rows: [["A", "1"], []] } });
  assert.equal(typeof validatePage({ title: "T", content: { kind: "table", columns: Array(41).fill("c"), rows: [] } }), "string");
});

test("nothing from the page can become markup or a script", () => {
  const evil = `<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) "quoted" 'single'`;
  for (const html of [notesHtml(evil), tableHtml([evil], [[evil]]), inline(evil)]) {
    assert.doesNotMatch(html, /<script|<img|<[^>]*onerror|href="javascript/i);
    assert.match(html, /&lt;script&gt;/);
  }
  assert.doesNotMatch(inline("[x](javascript:alert(1))"), /<a /);
});

test("links are http(s) only, open apart, pass nothing on", () => {
  const h = inline("See https://example.com/a?b=1&c=2. And [docs](https://example.org/x)");
  assert.match(h, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="nofollow noopener noreferrer ugc" target="_blank">example\.com\/a\?b=1&amp;c=2<\/a>\./);
  assert.match(h, /<a href="https:\/\/example\.org\/x"[^>]*>docs<\/a>/);
});

test("notes: headings, lists, quotes, code, paragraphs; Arabic reads right to left", () => {
  const h = notesHtml("# Plan\n\nFirst **bold** line\nsecond line\n\n- one\n- two\n1. a\n\n> quote\n\n```\n<b>code</b>\n```\nمرحبا");
  assert.match(h, /<h2 dir="auto">Plan<\/h2>/);
  assert.match(h, /<p dir="auto">First <strong>bold<\/strong> line<br>second line<\/p>/);
  assert.match(h, /<ul>\n<li dir="auto">one<\/li>\n<li dir="auto">two<\/li>\n<\/ul>\n<ol>\n<li dir="auto">a<\/li>\n<\/ol>/);
  assert.match(h, /<blockquote dir="auto">quote<\/blockquote>/);
  assert.match(h, /<pre><code>&lt;b&gt;code&lt;\/b&gt;<\/code><\/pre>/);
  assert.match(h, /<p dir="auto">مرحبا<\/p>/);
});

test("table page", () => {
  const h = pageHtml({ kind: "table", columns: ["Name", "Site"], rows: [["Café A", "https://a.dz"]] });
  assert.match(h, /<th dir="auto">Name<\/th>/);
  assert.match(h, /<td dir="auto">Café A<\/td><td dir="auto"><a href="https:\/\/a\.dz\/"/);
});
