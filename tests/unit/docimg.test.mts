import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  chartKind, hexColor, toNumber, normalizeChart, colLetter, colNumber, sheetRef, parseCellRef, resolveRangeChart, chartXml, drawingXml,
  addDrawingToSheet, addRels, injectXlsxCharts, pptxChart, inlineXlsxChart, chartAnchor, chartDataRows, worksheetParts, isRtlText,
} from "../../lib/charts.ts";
import { stripDownloadsPrefix, sniffImage, fitContain, parseOpenverse, parseCommons, creditLine, orientationFor, photoQuery, openverseUrl, validImage } from "../../lib/media.ts";
import { textDirection, sizeOf, normalizeCard, cardHtml, cssHex, contrast, onColor, chartHtml, formatValue, escHtml } from "../../lib/card.ts";

const require = createRequire(import.meta.url);

// ---------- charts ----------

test("chart kinds and colors", () => {
  assert.equal(chartKind(undefined), "column");
  assert.equal(chartKind("Donut"), "doughnut");
  assert.equal(chartKind("horizontal_bar"), "bar");
  assert.equal(chartKind("line"), "line");
  assert.equal(chartKind("radar3d"), null);
  assert.equal(hexColor("#c0392b"), "C0392B");
  assert.equal(hexColor("fff"), "FFFFFF");
  assert.equal(hexColor("red"), null);
  assert.equal(hexColor('"/><script>'), null);
});

test("numbers from strings", () => {
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber("$300"), 300);
  assert.equal(toNumber("12 000 DZD"), 12000);
  assert.equal(toNumber("abc"), null);
  assert.equal(toNumber(Infinity), null);
  assert.equal(toNumber(true), null);
});

test("inline charts normalize, pad and reject empty data", () => {
  const c = normalizeChart({ type: "pie", title: "Mix", labels: ["Coffee", "Tea", "Cake"], values: [50, "30", 20] });
  assert.ok(typeof c !== "string");
  assert.equal(c.type, "pie");
  assert.deepEqual(c.series[0]!.values, [50, 30, 20]);
  assert.equal(c.showValues, true);
  const m = normalizeChart({ type: "column", categories: ["A", "B", "C"], series: [{ name: "x", values: [1] }, { name: "y", values: [1, 2, 3, 4] }] });
  assert.ok(typeof m !== "string");
  assert.deepEqual(m.categories, ["A", "B", "C", "4"]);
  assert.deepEqual(m.series[0]!.values, [1, null, null, null]);
  assert.equal(typeof normalizeChart({ type: "bar", categories: ["a"], series: [{ values: ["x"] }] }), "string");
  assert.equal(typeof normalizeChart({ type: "radar" }), "string");
  assert.equal(typeof normalizeChart(null), "string");
  const pie2 = normalizeChart({ type: "pie", categories: ["a", "b"], series: [{ values: [1, 2] }, { values: [3, 4] }] });
  assert.ok(typeof pie2 !== "string" && pie2.series.length === 1);
});

test("cell references", () => {
  assert.equal(colLetter(1), "A");
  assert.equal(colLetter(26), "Z");
  assert.equal(colLetter(27), "AA");
  assert.equal(colLetter(703), "AAA");
  for (const n of [1, 25, 26, 27, 52, 702, 703, 16384]) assert.equal(colNumber(colLetter(n)), n);
  assert.equal(sheetRef("Sales", 2, 2, 9), "'Sales'!$B$2:$B$9");
  assert.equal(sheetRef("Bob's", 1, 1), "'Bob''s'!$A$1");
  assert.deepEqual(parseCellRef("h2"), { col: 8, row: 2 });
  assert.deepEqual(parseCellRef("$C$10"), { col: 3, row: 10 });
  assert.equal(parseCellRef("2H"), null);
  assert.equal(parseCellRef("ZZZZ1"), null);
});

const sheet = {
  name: "Ventes",
  columns: ["Mois", "Café", "Thé", "Note"],
  rows: [
    ["Jan", 120, 40, "ok"],
    ["Feb", 150, "45", "ok"],
    ["Mar", "=B2+B3", 50, null],
    ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", null],
  ] as (string | number | null)[][],
};

test("range charts: defaults pick numeric columns and skip a Total row", () => {
  const c = resolveRangeChart({ type: "column", title: "Ventes" }, sheet);
  assert.ok(typeof c !== "string");
  assert.equal(c.cat.ref, "'Ventes'!$A$2:$A$4");
  assert.deepEqual(c.cat.cache, ["Jan", "Feb", "Mar"]);
  assert.deepEqual(c.series.map((s) => s.name), ["Café", "Thé"]);
  assert.equal(c.series[0]!.ref, "'Ventes'!$B$2:$B$4");
  assert.equal(c.series[0]!.nameRef, "'Ventes'!$B$1");
  assert.deepEqual(c.series[0]!.cache, [120, 150, null]);
  assert.deepEqual(c.series[1]!.cache, [40, 45, 50]);
});

test("range charts: named columns, explicit rows, pie keeps one series, errors", () => {
  const c = resolveRangeChart({ type: "pie", category_column: "mois", value_columns: ["C", "Café"], first_row: 2, last_row: 5 }, sheet);
  assert.ok(typeof c !== "string");
  assert.equal(c.series.length, 1);
  assert.equal(c.series[0]!.ref, "'Ventes'!$C$2:$C$5");
  assert.equal(c.showValues, true);
  assert.match(String(resolveRangeChart({ value_columns: ["Prix"] }, sheet)), /isn't a column/);
  assert.match(String(resolveRangeChart({ category_column: "Nope" }, sheet)), /isn't a column/);
  assert.match(String(resolveRangeChart({}, { name: "E", columns: ["a"], rows: [] })), /no data rows/);
  assert.match(String(resolveRangeChart({}, { name: "T", columns: ["a", "b"], rows: [["x", "y"]] })), /No numeric column/);
});

test("anchors and inline chart data", () => {
  assert.deepEqual(chartAnchor("J3", sheet, 0), { col: 10, row: 3, cols: 8, rows: 18 });
  assert.deepEqual(chartAnchor(undefined, sheet, 1), { col: 6, row: 22, cols: 8, rows: 18 });
  const wide = { name: "W", columns: Array.from({ length: 20 }, (_, i) => `c${i}`), rows: [[1], [2]] };
  assert.equal(chartAnchor(undefined, wide, 0).row, 6);
  const c = normalizeChart({ type: "line", title: "Trend", categories: ["Q1", "Q2"], series: [{ name: "A", values: [1, 2] }] });
  assert.ok(typeof c !== "string");
  assert.deepEqual(chartDataRows(c), [["Trend", "A"], ["Q1", 1], ["Q2", 2]]);
  const x = inlineXlsxChart(c, "Chart data", 5, { col: 1, row: 1, cols: 8, rows: 18 });
  assert.equal(x.cat.ref, "'Chart data'!$A$6:$A$7");
  assert.equal(x.series[0]!.nameRef, "'Chart data'!$B$5");
});

test("chart XML: right chart element, escaped refs and titles, RTL titles", () => {
  const c = resolveRangeChart({ type: "bar", title: "A & B <x>" }, sheet);
  assert.ok(typeof c !== "string");
  const xml = chartXml(c);
  assert.match(xml, /<c:barChart><c:barDir val="bar"\/><c:grouping val="clustered"\/>/);
  assert.match(xml, /A &amp; B &lt;x&gt;/);
  assert.match(xml, /<c:f>&apos;Ventes&apos;!\$A\$2:\$A\$4<\/c:f>/);
  assert.equal((xml.match(/<c:ser>/g) ?? []).length, 2);
  assert.match(xml, /<c:catAx>.*<c:valAx>/);
  const pie = chartXml({ ...c, type: "doughnut", series: c.series.slice(0, 1), title: "المبيعات" });
  assert.match(pie, /<c:doughnutChart><c:varyColors val="1"\/>/);
  assert.match(pie, /<c:holeSize val="55"\/>/);
  assert.match(pie, /<a:pPr rtl="1">/);
  assert.doesNotMatch(pie, /<c:catAx>/);
  assert.match(chartXml({ ...c, type: "line" }), /<c:lineChart><c:grouping val="standard"\/>.*<c:marker val="1"\/>/);
  assert.match(chartXml({ ...c, type: "area", stacked: true }), /<c:areaChart><c:grouping val="stacked"\/>/);
  assert.match(chartXml({ ...c, type: "column", stacked: true }), /<c:grouping val="stacked"\/>.*<c:overlap val="100"\/>/);
  const d = drawingXml([{ col: 6, row: 2, cols: 8, rows: 18, rId: "rIdChart1", id: 1001, name: 'Chart "1"' }]);
  assert.match(d, /<xdr:from><xdr:col>5<\/xdr:col>.*<xdr:row>1<\/xdr:row>/);
  assert.match(d, /<xdr:to><xdr:col>13<\/xdr:col>.*<xdr:row>19<\/xdr:row>/);
  assert.match(d, /name="Chart &quot;1&quot;"/);
});

test("drawing goes before tableParts/extLst; xmlns:r is added if missing", () => {
  const ws = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><pageMargins left="0.7"/><tableParts count="1"/></worksheet>`;
  const out = addDrawingToSheet(ws, "rIdDrawing1");
  assert.match(out, /<pageMargins left="0.7"\/><drawing r:id="rIdDrawing1"\/><tableParts/);
  assert.match(out, /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/);
  const plain = addDrawingToSheet(`<worksheet xmlns:r="x"><sheetData/></worksheet>`, "r1");
  assert.equal(plain, `<worksheet xmlns:r="x"><sheetData/><drawing r:id="r1"/></worksheet>`);
  assert.match(addRels(null, [{ id: "a", type: "t", target: "../x.xml" }]), /<Relationships xmlns=.*<Relationship Id="a" Type="t" Target="..\/x.xml"\/><\/Relationships>$/);
});

function fakeZip(files: Record<string, string>) {
  const m = new Map(Object.entries(files));
  return { m, io: { read: async (p: string) => m.get(p) ?? null, write: (p: string, d: string) => void m.set(p, d), list: () => [...m.keys()] } };
}

test("inject charts into a minimal workbook (sheet order from workbook.xml)", async () => {
  const { m, io } = fakeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="B" sheetId="2" r:id="rId2"/><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns:r="r"><sheetData/></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet xmlns:r="r"><sheetData/></worksheet>`,
    "xl/worksheets/_rels/sheet2.xml.rels": `<Relationships xmlns="x"><Relationship Id="rIdDrawing1" Type="h" Target="http://x" TargetMode="External"/></Relationships>`,
  });
  assert.deepEqual(await worksheetParts(io), ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet1.xml"]);
  const c = resolveRangeChart({ type: "column" }, sheet);
  assert.ok(typeof c !== "string");
  const made = await injectXlsxCharts(io, [{ sheet: 0, charts: [{ ...c, anchor: { col: 6, row: 2, cols: 8, rows: 18 } }, { ...c, type: "line", anchor: { col: 6, row: 22, cols: 8, rows: 18 } }] }]);
  assert.equal(made, 2);
  assert.ok(m.has("xl/charts/chart1.xml") && m.has("xl/charts/chart2.xml"));
  assert.match(m.get("xl/worksheets/sheet2.xml")!, /<drawing r:id="rIdDrawing1_2"\/><\/worksheet>/);
  assert.equal(m.get("xl/worksheets/sheet1.xml"), `<worksheet xmlns:r="r"><sheetData/></worksheet>`);
  assert.match(m.get("xl/worksheets/_rels/sheet2.xml.rels")!, /Id="rIdDrawing1_2" Type="[^"]+\/drawing" Target="..\/drawings\/drawing1.xml"/);
  assert.match(m.get("xl/drawings/_rels/drawing1.xml.rels")!, /Target="..\/charts\/chart1.xml".*Target="..\/charts\/chart2.xml"/);
  assert.equal((m.get("xl/drawings/drawing1.xml")!.match(/<xdr:twoCellAnchor/g) ?? []).length, 2);
  const ct = m.get("[Content_Types].xml")!;
  assert.match(ct, /PartName="\/xl\/charts\/chart1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawingml.chart\+xml"/);
  assert.match(ct, /PartName="\/xl\/drawings\/drawing1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawing\+xml"/);
  assert.match(ct, /<\/Types>$/);
});

test("inject charts into a real exceljs workbook and read it back", async () => {
  const ExcelJS = require("exceljs");
  const JSZip = require("jszip");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ventes");
  ws.addRow(sheet.columns);
  for (const r of sheet.rows) ws.addRow(r.map((v) => (typeof v === "string" && v.startsWith("=") ? { formula: v.slice(1) } : v)));
  ws.autoFilter = "A1:D1";
  wb.addWorksheet("Other").addRow([1]);
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const io = { read: async (p: string) => (await zip.file(p)?.async("string")) ?? null, write: (p: string, d: string) => void zip.file(p, d), list: () => Object.keys(zip.files) };
  const c = resolveRangeChart({ type: "column", title: "Ventes" }, sheet);
  assert.ok(typeof c !== "string");
  assert.equal(await injectXlsxCharts(io, [{ sheet: 0, charts: [{ ...c, anchor: chartAnchor(undefined, sheet, 0) }] }]), 1);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  assert.equal(back.getWorksheet("Ventes").getCell("B2").value, 120);
  const z2 = await JSZip.loadAsync(buf);
  const sx = await z2.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(sx, /<drawing r:id="[^"]+"\/>/);
  assert.ok(sx.indexOf("<drawing") > sx.indexOf("</sheetData>"));
  assert.ok(z2.file("xl/charts/chart1.xml"));
});

test("PowerPoint chart options", () => {
  const c = normalizeChart({ type: "bar", title: "مبيعات", categories: ["أ", "ب"], series: [{ name: "x", values: [1, 2] }], number_format: "0%" });
  assert.ok(typeof c !== "string");
  const p = pptxChart(c, { text: "333333", muted: "777777" });
  assert.equal(p.type, "bar");
  assert.equal(p.opts.barDir, "bar");
  assert.equal(p.opts.lang, "ar-SA");
  assert.equal(p.opts.valAxisLabelFormatCode, "0%");
  assert.deepEqual(p.data, [{ name: "x", labels: ["أ", "ب"], values: [1, 2] }]);
  const col = pptxChart({ ...c, type: "column", title: "" }, { text: "000000" });
  assert.equal(col.type, "bar");
  assert.equal(col.opts.barDir, "col");
  assert.equal(col.opts.showTitle, false);
  const pie = pptxChart({ ...c, type: "pie", showValues: true }, { text: "000000" });
  assert.equal(pie.opts.showPercent, true);
  assert.equal(pie.opts.showLegend, true);
  assert.ok(isRtlText("مرحبا") && !isRtlText("hello"));
});

// ---------- media ----------

function png(w: number, h: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

test("sniff image headers", () => {
  assert.deepEqual(sniffImage(png(1080, 1350)), { kind: "png", width: 1080, height: 1350, mime: "image/png" });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sniffImage(jpg), { kind: "jpeg", width: 800, height: 600, mime: "image/jpeg" });
  const gif = new Uint8Array(24);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(sniffImage(gif), { kind: "gif", width: 320, height: 240, mime: "image/gif" });
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0x37, 0x04, 0x00], 24); // 1080 - 1
  webp.set([0x37, 0x04, 0x00], 27);
  assert.deepEqual(sniffImage(webp), { kind: "webp", width: 1080, height: 1080, mime: "image/webp" });
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(validImage(sniffImage(png(0, 10))), false);
});

test("fit a picture in a box", () => {
  assert.deepEqual(fitContain(2000, 1000, { x: 0, y: 0, w: 4, h: 4 }), { x: 0, y: 1, w: 4, h: 2 });
  assert.deepEqual(fitContain(1000, 2000, { x: 1, y: 1, w: 4, h: 4 }), { x: 2, y: 1, w: 2, h: 4 });
  assert.equal(orientationFor(1920, 1080), "wide");
  assert.equal(orientationFor(1080, 1920), "tall");
  assert.equal(orientationFor(1080, 1350), "square");
});

test("free photo results: licenses, sizes and credits", () => {
  const ov = parseOpenverse({
    results: [
      { url: "https://live.staticflickr.com/a.jpg", license: "by", license_version: "2.0", creator: "Jane <b>Doe</b>", filetype: "jpg", width: 2000, height: 1500, foreign_landing_url: "https://flickr.com/x" },
      { url: "https://x/b.jpg", license: "by-nc", creator: "NC", filetype: "jpg", width: 2000 },
      { url: "http://x/c.jpg", license: "cc0", width: 2000 },
      { url: "https://x/d.jpg", license: "cc0", width: 300 },
      { url: "https://x/e.svg", license: "cc0", filetype: "svg", width: 3000 },
      { url: "https://x/f.png", license: "pdm", filetype: "png" },
    ],
  });
  assert.deepEqual(ov.map((c) => c.license), ["CC BY 2.0", "Public domain"]);
  assert.equal(ov[0]!.creator, "Jane Doe");
  assert.equal(creditLine(ov[0]!), "Photo: Jane Doe, CC BY 2.0 (Openverse)");
  assert.deepEqual(parseOpenverse({}), []);
  const cm = parseCommons({
    query: {
      pages: {
        "2": { index: 2, title: "File:Cafe.jpg", imageinfo: [{ mime: "image/jpeg", width: 4000, thumburl: "https://upload.wikimedia.org/t.jpg", thumbwidth: 1600, thumbheight: 1200, extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: '<a href="x">Ali</a>' } } }] },
        "1": { index: 1, title: "File:NC.jpg", imageinfo: [{ mime: "image/jpeg", width: 4000, url: "https://u/n.jpg", extmetadata: { LicenseShortName: { value: "CC BY-NC 2.0" } } }] },
        "3": { index: 3, title: "File:Logo.png", imageinfo: [{ mime: "image/png", width: 4000, url: "https://u/l.png", extmetadata: { LicenseShortName: { value: "Fair use" } } }] },
      },
    },
  });
  assert.equal(cm.length, 1);
  assert.equal(cm[0]!.creator, "Ali");
  assert.equal(cm[0]!.width, 1600);
  assert.equal(creditLine({ creator: "unknown", license: "CC0", source: "Openverse" }), "Photo: CC0 (Openverse)");
  assert.equal(photoQuery("  café <script> & 'latte'!! "), "café 'latte'");
  assert.match(openverseUrl("coffee cup", "square"), /^https:\/\/api\.openverse\.org\/v1\/images\/\?q=coffee\+cup&.*license_type=commercial.*aspect_ratio=square/);
});

// ---------- designed images ----------

test("direction and sizes", () => {
  assert.equal(textDirection("قهوة الصباح بسعر خاص"), "rtl");
  assert.equal(textDirection("Café du matin — offre spéciale"), "ltr");
  assert.equal(textDirection("Promo 50% على كل القهوة"), "rtl");
  assert.deepEqual(sizeOf("square"), [1080, 1080]);
  assert.deepEqual(sizeOf("portrait"), [1080, 1350]);
  assert.deepEqual(sizeOf("landscape"), [1920, 1080]);
  assert.deepEqual(sizeOf("story"), [1080, 1920]);
  assert.deepEqual(sizeOf("1200x628"), [1200, 628]);
  assert.deepEqual(sizeOf("9999x100"), [2400, 256]);
  assert.deepEqual(sizeOf("Instagram story"), [1080, 1920]);
  assert.deepEqual(sizeOf(undefined), [1080, 1080]);
  assert.deepEqual(sizeOf("x", 50000, 1), [2400, 256]);
});

test("colors are validated and kept readable", () => {
  assert.equal(cssHex("#abc"), "#AABBCC");
  assert.equal(cssHex("red;}body{display:none"), null);
  assert.equal(onColor("#FFD23F"), "#111111");
  assert.equal(onColor("#0B2545"), "#FFFFFF");
  assert.ok(contrast("#000000", "#FFFFFF") > 20);
  const s = normalizeCard({ headline: "Hi", colors: { background: "#FFFFFF", text: "#FAFAFA" } });
  assert.ok(typeof s !== "string");
  assert.equal(s.colors.text, "#111111");
  const p = normalizeCard({ headline: "Hi", palette: "ocean" });
  assert.ok(typeof p !== "string" && p.colors.bg === "#0B2545");
});

test("card spec defaults and errors", () => {
  assert.match(String(normalizeCard({})), /headline is required/);
  const s = normalizeCard({ headline: "عرض خاص على القهوة", style: "flyer", size: "story", points: ["a", { value: "50%", label: "off" }, "", null], photo_layout: "side" }, true);
  assert.ok(typeof s !== "string");
  assert.equal(s.style, "poster");
  assert.equal(s.dir, "rtl");
  assert.equal(s.lang, "ar");
  assert.deepEqual([s.width, s.height], [1080, 1920]);
  assert.deepEqual(s.points, [{ label: "a" }, { value: "50%", label: "off" }]);
  assert.equal(s.photoLayout, "side");
  assert.equal(s.align, "center");
  const q = normalizeCard({ headline: "Be kind", style: "quote" });
  assert.ok(typeof q !== "string" && q.font === "serif" && q.photoLayout === "none");
  const w = normalizeCard({ headline: "Wide", size: "landscape" }, true);
  assert.ok(typeof w !== "string" && w.photoLayout === "side");
});

test("card HTML escapes text, sets direction, no letter-spacing for Arabic", () => {
  const s = normalizeCard({ headline: "<script>alert(1)</script> قهوة", body: "سطر\nسطر", footer: "Café & Co", cta: "اطلب الآن" });
  assert.ok(typeof s !== "string");
  const html = cardHtml(s);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /سطر<br>سطر/);
  assert.match(html, /Café &amp; Co/);
  assert.doesNotMatch(html.match(/h1\{[^}]*\}/)![0], /letter-spacing/);
  assert.match(html, /data-ready/);
  const en = normalizeCard({ headline: "Fresh coffee", style: "infographic", points: [{ value: "3x", label: "faster" }, { value: "98%", label: "happy" }] });
  assert.ok(typeof en !== "string");
  const h2 = cardHtml(en, { photo: { dataUri: "data:image/png;base64,AAAA", credit: "Photo: X" } });
  assert.match(h2, /<html lang="en" dir="ltr">/);
  assert.match(h2, /class="stats n2"/);
  assert.doesNotMatch(h2, /data:image\/png/); // photo layout is "none" unless the spec says a photo exists
  const withPhoto = normalizeCard({ headline: "Fresh coffee" }, true);
  assert.ok(typeof withPhoto !== "string");
  const h3 = cardHtml(withPhoto, { photo: { dataUri: "data:image/png;base64,AAAA", credit: "Photo: X" } });
  assert.match(h3, /url\("data:image\/png;base64,AAAA"\)/);
  assert.match(h3, /class="bgimg"/);
  assert.match(h3, /Photo: X/);
});

test("chart HTML for images", () => {
  const c = normalizeChart({ type: "doughnut", labels: ["A", "B"], values: [1, 3] });
  assert.ok(typeof c !== "string");
  const pie = chartHtml(c, { text: "#000", accent: "#f00" });
  assert.match(pie, /<svg viewBox="0 0 100 100" class="pie-svg">/);
  assert.match(pie, /<b>75%<\/b>/);
  const bar = chartHtml({ ...c, type: "bar", title: "<b>" }, { text: "#000", accent: "#f00" });
  assert.match(bar, /&lt;b&gt;/);
  assert.match(bar, /width:100.0%/);
  assert.match(chartHtml({ ...c, type: "line" }, { text: "#000", accent: "#f00" }), /<polyline/);
  assert.match(chartHtml({ ...c, type: "column" }, { text: "#000", accent: "#f00" }), /class="vbars"/);
  assert.equal(formatValue(0.255, "0%"), "25.5%");
  assert.equal(formatValue(1234.5), "1,234.5");
  assert.equal(escHtml(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("Downloads/oovi prefixes are stripped from bot paths", () => {
  assert.equal(stripDownloadsPrefix("Downloads/oovi/Brief.docx"), "Brief.docx");
  assert.equal(stripDownloadsPrefix(String.raw`downloads\oovi\Brief.docx`), "Brief.docx");
  assert.equal(stripDownloadsPrefix("OOVI/sub/x.png"), "sub/x.png");
  assert.equal(stripDownloadsPrefix("./Brief.docx"), "Brief.docx");
  assert.equal(stripDoublesafe("'Brief.docx'"), "Brief.docx");
  assert.equal(stripDownloadsPrefix("oovi-notes.md"), "oovi-notes.md");
  assert.equal(stripDownloadsPrefix("Brief.docx"), "Brief.docx");
});
function stripDoublesafe(s: string) { return stripDownloadsPrefix(s); }
