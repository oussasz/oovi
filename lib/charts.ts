// Charts for the files bots make: one chart description, three outputs.
// - Excel: real chart parts (DrawingML) injected into the .xlsx, pointing at the sheet's cells,
//   so the chart updates when the numbers change (exceljs can't write charts itself).
// - PowerPoint: options for pptxgenjs' native addChart.
// - Images: plain data for the SVG chart in lib/card.ts.
//
// Pure: no imports with side effects (unit-tested straight from the .ts file).

export type ChartKind = "column" | "bar" | "line" | "pie" | "doughnut" | "area";
export const CHART_KINDS: readonly ChartKind[] = ["column", "bar", "line", "pie", "doughnut", "area"];
export type Cell = string | number | boolean | null;
export type ChartSeries = { name: string; values: (number | null)[] };
/** A chart with its numbers written out (slides, images, and Excel charts made from inline data). */
export type ChartData = {
  type: ChartKind;
  title: string;
  categories: string[];
  series: ChartSeries[];
  stacked: boolean;
  showValues: boolean;
  numberFormat?: string;
  colors: string[];
};

export const PALETTE = ["4F6BED", "E07A3F", "2BB39A", "F2B134", "9B6BD6", "E05A7A", "5AA9E6", "7C8B9A", "C2185B", "558B2F", "6D4C41", "00838F"];
export const MAX_CATEGORIES = 200;
export const MAX_SERIES = 12;

const str = (v: unknown, max = 200) => (v === null || v === undefined ? "" : String(v)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);

export function chartKind(v: unknown): ChartKind | null {
  const s = str(v, 40).toLowerCase().trim().replace(/[\s_-]+/g, " ");
  if (!s) return "column";
  if ((CHART_KINDS as readonly string[]).includes(s)) return s as ChartKind;
  if (s === "donut" || s === "ring") return "doughnut";
  if (s === "horizontal bar" || s === "bar horizontal" || s === "hbar") return "bar";
  if (s === "vertical bar" || s === "columns" || s === "histogram") return "column";
  if (s === "lines" || s === "trend" || s === "spline") return "line";
  if (s === "pie chart" || s === "camembert") return "pie";
  return null;
}

export function hexColor(v: unknown): string | null {
  const s = str(v, 12).trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(s)) return s.replace(/./g, (c) => c + c).toUpperCase();
  return null;
}

const colorsOf = (v: unknown): string[] => {
  const own = (Array.isArray(v) ? v : []).map(hexColor).filter((c): c is string => !!c).slice(0, MAX_SERIES);
  return [...own, ...PALETTE.filter((c) => !own.includes(c))];
};

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null || v === undefined) return null;
  const s = String(v).trim().replace(/[\s,  ]/g, "").replace(/[$€£¥%]|DZD|MAD|TND|EUR|USD|د\.ج/gi, "");
  if (!s || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const numberFormatOf = (v: unknown) => {
  const s = str(v, 60).trim();
  return s && !/[<>&]/.test(s) ? s : undefined;
};

/**
 * A chart with inline numbers: {categories, series:[{name, values}]}, or the one-series
 * shorthand {labels, values}. Returns an error message when there's nothing to draw.
 */
export function normalizeChart(raw: unknown): ChartData | string {
  if (!raw || typeof raw !== "object") return "chart must be an object with categories and series.";
  const r = raw as Record<string, unknown>;
  const type = chartKind(r.type);
  if (!type) return `Unknown chart type "${str(r.type, 30)}". Use one of: ${CHART_KINDS.join(", ")}.`;
  const cats = (Array.isArray(r.categories) ? r.categories : Array.isArray(r.labels) ? r.labels : []).slice(0, MAX_CATEGORIES).map((c) => str(c, 120));
  let rawSeries: unknown[] = Array.isArray(r.series) ? r.series : [];
  if (!rawSeries.length && Array.isArray(r.values)) rawSeries = [{ name: r.series_name ?? r.title ?? "Series 1", values: r.values }];
  const series: ChartSeries[] = rawSeries.slice(0, MAX_SERIES).map((s, i) => {
    const o = (s && typeof s === "object" && !Array.isArray(s) ? s : { values: s }) as Record<string, unknown>;
    const vals = (Array.isArray(o.values) ? o.values : Array.isArray(o.data) ? o.data : []).slice(0, MAX_CATEGORIES).map(toNumber);
    return { name: str(o.name ?? o.label, 120) || `Series ${i + 1}`, values: vals };
  });
  const n = Math.max(cats.length, ...series.map((s) => s.values.length), 0);
  if (!n || !series.some((s) => s.values.some((v) => v !== null))) return "The chart needs numbers: give categories and series with values (or labels and values).";
  for (let i = cats.length; i < n; i++) cats.push(String(i + 1));
  for (const s of series) while (s.values.length < n) s.values.push(null);
  const pieLike = type === "pie" || type === "doughnut";
  return {
    type,
    title: str(r.title, 200),
    categories: cats,
    series: pieLike ? series.slice(0, 1) : series,
    stacked: r.stacked === true && !pieLike,
    showValues: r.show_values === true || (r.show_values !== false && pieLike),
    numberFormat: numberFormatOf(r.number_format),
    colors: colorsOf(r.colors),
  };
}

// ---------- Excel: cell references ----------

export function colLetter(n: number): string {
  let s = "";
  for (let x = Math.max(1, Math.floor(n)); x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 'Sheet name'!$A$2:$A$9 — always quoted, so any sheet name works. */
export function sheetRef(sheet: string, col: number, row1: number, row2 = row1): string {
  const q = `'${sheet.replace(/'/g, "''")}'`;
  const c = colLetter(col);
  return row1 === row2 ? `${q}!$${c}$${row1}` : `${q}!$${c}$${row1}:$${c}$${row2}`;
}

/** "H2" -> {col: 8, row: 2} (1-based). */
export function parseCellRef(v: unknown): { col: number; row: number } | null {
  const m = str(v, 12).trim().toUpperCase().replace(/\$/g, "").match(/^([A-Z]{1,3})(\d{1,7})$/);
  if (!m) return null;
  const col = colNumber(m[1]!);
  const row = Number(m[2]);
  return col >= 1 && col <= 16384 && row >= 1 && row <= 1_048_576 ? { col, row } : null;
}

export type SheetData = { name: string; columns: string[]; rows: Cell[][] };
export type XlsxSeries = { name: string; nameRef?: string; ref: string; cache: (number | null)[] };
export type XlsxChart = {
  type: ChartKind;
  title: string;
  stacked: boolean;
  showValues: boolean;
  numberFormat?: string;
  colors: string[];
  cat: { ref: string; cache: (string | null)[] };
  series: XlsxSeries[];
  /** Top-left cell (1-based) and size in cells. */
  anchor: { col: number; row: number; cols: number; rows: number };
};

const isFormula = (v: Cell | undefined) => typeof v === "string" && v.startsWith("=");
const TOTAL_ROW = /^\s*(grand\s+total|totals?|sum|subtotal|total\s+g[ée]n[ée]ral|totaux|somme|المجموع(\s+الكلي)?|الإجمالي|المجموع\s+العام)\s*:?\s*$/i;

/** Which column a chart means: a header name, a letter ("B") or a 1-based number. */
export function findColumn(v: unknown, columns: string[]): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= Math.max(columns.length, 1) + 200) return v;
  const s = str(v, 120).trim();
  if (!s) return null;
  const byName = columns.findIndex((c) => c.trim().toLowerCase() === s.toLowerCase());
  if (byName >= 0) return byName + 1;
  if (/^[A-Z]{1,3}$/i.test(s)) return colNumber(s);
  if (/^\d{1,4}$/.test(s)) return Number(s);
  return null;
}

/**
 * A chart over cells already in a sheet. Columns by header name or letter; rows are sheet row
 * numbers (row 1 is the header). Defaults: first column = categories, every mostly-numeric
 * column after it = one series, all data rows except a trailing "Total" row.
 */
export function resolveRangeChart(raw: Record<string, unknown>, sheet: SheetData): Omit<XlsxChart, "anchor"> | string {
  const type = chartKind(raw.type);
  if (!type) return `Unknown chart type "${str(raw.type, 30)}". Use one of: ${CHART_KINDS.join(", ")}.`;
  const { columns, rows } = sheet;
  if (!rows.length) return `Sheet "${sheet.name}" has no data rows to chart.`;
  const width = rows.reduce((w, r) => Math.max(w, r.length), columns.length);
  const catCol = raw.category_column === undefined || raw.category_column === null || raw.category_column === "" ? 1 : findColumn(raw.category_column, columns);
  if (!catCol || catCol > width) return `category_column "${str(raw.category_column, 60)}" isn't a column of "${sheet.name}" (columns: ${columns.join(", ")}).`;

  let first = typeof raw.first_row === "number" ? Math.floor(raw.first_row) : 2;
  let last = typeof raw.last_row === "number" ? Math.floor(raw.last_row) : rows.length + 1;
  first = Math.max(2, Math.min(first, rows.length + 1));
  last = Math.max(first, Math.min(last, rows.length + 1));
  if (typeof raw.last_row !== "number" && last > first) {
    const lastCat = rows[last - 2]?.[catCol - 1];
    if (typeof lastCat === "string" && TOTAL_ROW.test(lastCat)) last--;
  }
  const dataRows = rows.slice(first - 2, last - 1);

  let valCols: number[];
  const asked = Array.isArray(raw.value_columns) ? raw.value_columns : raw.value_columns !== undefined && raw.value_columns !== null && raw.value_columns !== "" ? [raw.value_columns] : [];
  if (asked.length) {
    valCols = [];
    for (const v of asked.slice(0, MAX_SERIES)) {
      const c = findColumn(v, columns);
      if (!c || c > width) return `value column "${str(v, 60)}" isn't a column of "${sheet.name}" (columns: ${columns.join(", ")}).`;
      valCols.push(c);
    }
  } else {
    valCols = [];
    for (let c = 1; c <= width && valCols.length < MAX_SERIES; c++) {
      if (c === catCol) continue;
      const vals = dataRows.map((r) => r[c - 1]);
      const numeric = vals.filter((v) => toNumber(v) !== null || isFormula(v)).length;
      const empty = vals.filter((v) => v === null || v === undefined || v === "").length;
      if (numeric > 0 && numeric + empty >= vals.length * 0.8) valCols.push(c);
    }
    if (!valCols.length) return `No numeric column to chart in "${sheet.name}". Name the columns with value_columns.`;
  }
  const pieLike = type === "pie" || type === "doughnut";
  if (pieLike) valCols = valCols.slice(0, 1);

  const catCache = dataRows.map((r) => {
    const v = r[catCol - 1];
    return v === null || v === undefined || isFormula(v) ? null : str(v, 255);
  });
  const series: XlsxSeries[] = valCols.map((c) => {
    const name = str(columns[c - 1], 255) || colLetter(c);
    return {
      name,
      nameRef: columns[c - 1] ? sheetRef(sheet.name, c, 1) : undefined,
      ref: sheetRef(sheet.name, c, first, last),
      cache: dataRows.map((r) => (isFormula(r[c - 1]) ? null : toNumber(r[c - 1]))),
    };
  });
  return {
    type,
    title: str(raw.title, 200),
    stacked: raw.stacked === true && !pieLike,
    showValues: raw.show_values === true || (raw.show_values !== false && pieLike),
    numberFormat: numberFormatOf(raw.number_format),
    colors: colorsOf(raw.colors),
    cat: { ref: sheetRef(sheet.name, catCol, first, last), cache: catCache },
    series,
  };
}

/** Rows to write for an inline chart (header + one row per category), for a "Chart data" sheet. */
export function chartDataRows(c: ChartData): Cell[][] {
  return [[c.title || "Category", ...c.series.map((s) => s.name)], ...c.categories.map((cat, i) => [cat, ...c.series.map((s) => s.values[i] ?? null)])];
}

/** An Excel chart over an inline chart's numbers written by chartDataRows at startRow of sheet. */
export function inlineXlsxChart(c: ChartData, sheet: string, startRow: number, anchor: XlsxChart["anchor"]): XlsxChart {
  const first = startRow + 1;
  const last = startRow + c.categories.length;
  return {
    type: c.type,
    title: c.title,
    stacked: c.stacked,
    showValues: c.showValues,
    numberFormat: c.numberFormat,
    colors: c.colors,
    cat: { ref: sheetRef(sheet, 1, first, last), cache: c.categories },
    series: c.series.map((s, j) => ({ name: s.name, nameRef: sheetRef(sheet, j + 2, startRow), ref: sheetRef(sheet, j + 2, first, last), cache: s.values })),
    anchor,
  };
}

/** Where a chart goes: the cell asked for, else right of the data (or under it when the data is wide). */
export function chartAnchor(at: unknown, sheet: SheetData, k: number, size = { cols: 8, rows: 18 }): XlsxChart["anchor"] {
  const cell = parseCellRef(at);
  if (cell) return { col: cell.col, row: cell.row, ...size };
  const width = sheet.rows.slice(0, 2000).reduce((w, r) => Math.max(w, r.length), Math.max(sheet.columns.length, 1));
  if (width <= 12) return { col: width + 2, row: 2 + k * (size.rows + 2), ...size };
  return { col: 1 + (k % 2) * (size.cols + 1), row: sheet.rows.length + 4 + Math.floor(k / 2) * (size.rows + 2), ...size };
}

// ---------- Excel: XML parts ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch] ?? ch);
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
export const isRtlText = (s: string) => RTL.test(s);

const solid = (hex: string) => `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>`;
const lineFill = (hex: string) => `<c:spPr><a:ln w="31750" cap="rnd"><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:round/></a:ln></c:spPr>`;

function strRef(ref: string, cache: (string | null)[]): string {
  const pts = cache.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`)).join("");
  return `<c:strRef><c:f>${esc(ref)}</c:f><c:strCache><c:ptCount val="${cache.length}"/>${pts}</c:strCache></c:strRef>`;
}

function numRef(ref: string, cache: (number | null)[], fmt: string): string {
  const pts = cache.map((v, i) => (v === null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("");
  return `<c:numRef><c:f>${esc(ref)}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${cache.length}"/>${pts}</c:numCache></c:numRef>`;
}

function dLbls(c: Omit<XlsxChart, "anchor">): string {
  if (!c.showValues) return "";
  const pie = c.type === "pie" || c.type === "doughnut";
  const fmt = c.numberFormat ? `<c:numFmt formatCode="${esc(c.numberFormat)}" sourceLinked="0"/>` : "";
  return `<c:dLbls>${fmt}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="${pie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pie ? 1 : 0}"/><c:showBubbleSize val="0"/>${pie ? '<c:showLeaderLines val="1"/>' : ""}</c:dLbls>`;
}

function titleXml(title: string): string {
  if (!title) return '<c:autoTitleDeleted val="1"/>';
  const rtl = isRtlText(title) ? ' rtl="1"' : "";
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr${rtl}><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="${rtl ? "ar-SA" : "en-US"}" sz="1400" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
}

const AX_CAT = 50010;
const AX_VAL = 50020;

function axes(c: Omit<XlsxChart, "anchor">): string {
  const horizontal = c.type === "bar";
  const fmt = c.numberFormat ? `<c:numFmt formatCode="${esc(c.numberFormat)}" sourceLinked="0"/>` : '<c:numFmt formatCode="General" sourceLinked="1"/>';
  const txt = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="595959"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
  const axLine = '<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>';
  const grid = '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E5E5E5"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';
  return (
    `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axLine}${txt}<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/>${grid}${fmt}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt}<c:crossAx val="${AX_CAT}"/><c:crosses val="${horizontal ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`
  );
}

/** xl/charts/chartN.xml */
export function chartXml(c: Omit<XlsxChart, "anchor">): string {
  const fmt = c.numberFormat || "General";
  const lbls = dLbls(c);
  const ser = (s: XlsxSeries, i: number, body: string) =>
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${s.nameRef ? `<c:tx>${strRef(s.nameRef, [s.name])}</c:tx>` : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`}${body}</c:ser>`;
  const catVal = (s: XlsxSeries) => `<c:cat>${strRef(c.cat.ref, c.cat.cache)}</c:cat><c:val>${numRef(s.ref, s.cache, fmt)}</c:val>`;
  const color = (i: number) => c.colors[i % c.colors.length] ?? PALETTE[i % PALETTE.length]!;
  let plot: string;
  if (c.type === "pie" || c.type === "doughnut") {
    const s = c.series[0]!;
    const pts = c.cat.cache.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${color(i)}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("");
    const body = ser(s, 0, `${pts}${lbls}${catVal(s)}`);
    plot = c.type === "pie" ? `<c:pieChart><c:varyColors val="1"/>${body}<c:firstSliceAng val="0"/></c:pieChart>` : `<c:doughnutChart><c:varyColors val="1"/>${body}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else if (c.type === "line") {
    const sers = c.series.map((s, i) => ser(s, i, `${lineFill(color(i))}<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color(i)}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>${lbls}${catVal(s)}<c:smooth val="0"/>`)).join("");
    plot = `<c:lineChart><c:grouping val="${c.stacked ? "stacked" : "standard"}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:lineChart>${axes(c)}`;
  } else if (c.type === "area") {
    const sers = c.series.map((s, i) => ser(s, i, `${solid(color(i))}${lbls}${catVal(s)}`)).join("");
    plot = `<c:areaChart><c:grouping val="${c.stacked ? "stacked" : "standard"}"/><c:varyColors val="0"/>${sers}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:areaChart>${axes(c)}`;
  } else {
    const sers = c.series.map((s, i) => ser(s, i, `${solid(color(i))}<c:invertIfNegative val="0"/>${lbls}${catVal(s)}`)).join("");
    plot = `<c:barChart><c:barDir val="${c.type === "bar" ? "bar" : "col"}"/><c:grouping val="${c.stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="${c.stacked ? 60 : 80}"/>${c.stacked ? '<c:overlap val="100"/>' : ""}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>${axes(c)}`;
  }
  const legend = c.series.length > 1 || c.type === "pie" || c.type === "doughnut" ? `<c:legend><c:legendPos val="${c.type === "pie" || c.type === "doughnut" ? "r" : "b"}"/><c:overlay val="0"/></c:legend>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:roundedCorners val="0"/><c:chart>${titleXml(c.title)}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `</c:chartSpace>`
  );
}

export type DrawingAnchor = { col: number; row: number; cols: number; rows: number; rId: string; id: number; name: string };

/** One <xdr:twoCellAnchor> holding a chart (cols/rows are 1-based like the anchor cell). */
export function anchorXml(a: DrawingAnchor): string {
  const c0 = a.col - 1;
  const r0 = a.row - 1;
  return (
    `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${c0 + a.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0 + a.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${a.id}" name="${esc(a.name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${a.rId}"/>` +
    `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
  );
}

export const drawingXml = (anchors: DrawingAnchor[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.map(anchorXml).join("")}</xdr:wsDr>`;

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";

/** Add relationships to a .rels file (or make one); returns the new XML. */
export function addRels(xml: string | null, rels: { id: string; type: string; target: string }[]): string {
  const add = rels.map((r) => `<Relationship Id="${esc(r.id)}" Type="${r.type}" Target="${esc(r.target)}"/>`).join("");
  if (!xml || !/<\/Relationships>/.test(xml)) return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${add}</Relationships>`;
  return xml.replace(/<\/Relationships>\s*$/, `${add}</Relationships>`);
}

export function relIds(xml: string | null): Set<string> {
  return new Set([...(xml ?? "").matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]!));
}

function uniqueId(taken: Set<string>, base: string): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

/** Put <drawing r:id=".."/> where the schema wants it in a worksheet. */
export function addDrawingToSheet(sheetXml: string, rId: string): string {
  let xml = sheetXml;
  const root = xml.match(/<worksheet\b[^>]*>/);
  if (root && !/\bxmlns:r=/.test(root[0])) xml = xml.replace(root[0], root[0].replace(/>$/, ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'));
  const tag = `<drawing r:id="${rId}"/>`;
  const after = ["legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"];
  let at = -1;
  for (const t of after) {
    const m = xml.search(new RegExp(`<${t}[\\s/>]`));
    if (m >= 0 && (at < 0 || m < at)) at = m;
  }
  if (at < 0) at = xml.lastIndexOf("</worksheet>");
  if (at < 0) throw new Error("Not a worksheet.");
  return xml.slice(0, at) + tag + xml.slice(at);
}

export function addContentTypes(xml: string, parts: { name: string; type: string }[]): string {
  const add = parts.filter((p) => !xml.includes(`PartName="${p.name}"`)).map((p) => `<Override PartName="${p.name}" ContentType="${p.type}"/>`).join("");
  return xml.replace(/<\/Types>\s*$/, `${add}</Types>`);
}

/** What injectXlsxCharts needs from a zip (JSZip in the app, a Map in tests). */
export type ZipIO = { read(path: string): Promise<string | null>; write(path: string, data: string): void; list(): string[] };

const normTarget = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

const relsPathOf = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
};

/** Worksheet part paths in workbook order. */
export async function worksheetParts(zip: ZipIO): Promise<string[]> {
  const wb = (await zip.read("xl/workbook.xml")) ?? "";
  const rels = (await zip.read("xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, normTarget("xl/workbook.xml", target));
  }
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => targets.get(m[0].match(/\br:id="([^"]+)"/)?.[1] ?? "") ?? "");
}

/** Write the chart parts for each sheet into a workbook made by exceljs. */
export async function injectXlsxCharts(zip: ZipIO, bySheet: { sheet: number; charts: XlsxChart[] }[]): Promise<number> {
  const sheets = await worksheetParts(zip);
  const names = new Set(zip.list());
  const next = (prefix: string) => {
    let n = 1;
    while (names.has(`${prefix}${n}.xml`)) n++;
    names.add(`${prefix}${n}.xml`);
    return n;
  };
  const types: { name: string; type: string }[] = [];
  let made = 0;
  for (const { sheet, charts } of bySheet) {
    const part = sheets[sheet];
    if (!part || !charts.length) continue;
    let sheetXml = await zip.read(part);
    if (!sheetXml) continue;
    const sheetRelsPath = relsPathOf(part);
    let sheetRels = await zip.read(sheetRelsPath);

    // A sheet with a drawing already (e.g. pictures): add the charts to it.
    let drawingPart: string;
    let drawingXmlStr: string | null = null;
    const existing = sheetXml.match(/<drawing\s+r:id="([^"]+)"/);
    const existingTarget = existing ? [...(sheetRels ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${existing[1]}"`))?.match(/\bTarget="([^"]+)"/)?.[1] : undefined;
    if (existingTarget) {
      drawingPart = normTarget(part, existingTarget);
      drawingXmlStr = await zip.read(drawingPart);
    } else {
      drawingPart = `xl/drawings/drawing${next("xl/drawings/drawing")}.xml`;
    }
    const drawingRelsPath = relsPathOf(drawingPart);
    let drawingRels = await zip.read(drawingRelsPath);
    const taken = relIds(drawingRels);
    const anchors: DrawingAnchor[] = [];
    const newRels: { id: string; type: string; target: string }[] = [];
    for (const c of charts) {
      const n = next("xl/charts/chart");
      const chartPart = `xl/charts/chart${n}.xml`;
      zip.write(chartPart, chartXml(c));
      types.push({ name: `/${chartPart}`, type: CT_CHART });
      const rId = uniqueId(taken, `rIdChart${n}`);
      newRels.push({ id: rId, type: REL_CHART, target: `../charts/chart${n}.xml` });
      anchors.push({ ...c.anchor, rId, id: 1000 + n, name: c.title ? `Chart ${n}: ${c.title}`.slice(0, 120) : `Chart ${n}` });
      made++;
    }
    drawingRels = addRels(drawingRels, newRels);
    zip.write(drawingRelsPath, drawingRels);
    if (drawingXmlStr && /<\/xdr:wsDr>/.test(drawingXmlStr)) {
      zip.write(drawingPart, drawingXmlStr.replace(/<\/xdr:wsDr>\s*$/, `${anchors.map(anchorXml).join("")}</xdr:wsDr>`));
    } else {
      zip.write(drawingPart, drawingXml(anchors));
      types.push({ name: `/${drawingPart}`, type: CT_DRAWING });
      const rId = uniqueId(relIds(sheetRels), "rIdDrawing1");
      sheetRels = addRels(sheetRels, [{ id: rId, type: REL_DRAWING, target: `../drawings/${drawingPart.split("/").pop()}` }]);
      zip.write(sheetRelsPath, sheetRels);
      sheetXml = addDrawingToSheet(sheetXml, rId);
      zip.write(part, sheetXml);
    }
  }
  if (types.length) {
    const ct = await zip.read("[Content_Types].xml");
    if (!ct) throw new Error("Not an .xlsx file.");
    zip.write("[Content_Types].xml", addContentTypes(ct, types));
  }
  return made;
}

// ---------- PowerPoint (pptxgenjs addChart) ----------

export type PptxChart = { type: "bar" | "line" | "pie" | "doughnut" | "area"; data: { name: string; labels: string[]; values: (number | null)[] }[]; opts: Record<string, unknown> };

/** Native PowerPoint chart options for a slide; colors are the slide theme's. */
export function pptxChart(c: ChartData, theme: { text: string; muted?: string; grid?: string; font?: string }): PptxChart {
  const pie = c.type === "pie" || c.type === "doughnut";
  const rtl = isRtlText(c.title + c.categories.join(""));
  const font = theme.font ?? "Calibri";
  const opts: Record<string, unknown> = {
    chartColors: pie ? c.colors.slice(0, Math.max(c.categories.length, 1)) : c.colors.slice(0, Math.max(c.series.length, 1)),
    showTitle: !!c.title,
    title: c.title || undefined,
    titleColor: theme.text,
    titleFontFace: font,
    titleFontSize: 16,
    showLegend: pie || c.series.length > 1,
    legendPos: pie ? "r" : "b",
    legendColor: theme.text,
    legendFontFace: font,
    legendFontSize: 12,
    showValue: c.showValues && !pie,
    showPercent: pie && c.showValues,
    dataLabelColor: theme.text,
    dataLabelFontSize: 11,
    lang: rtl ? "ar-SA" : "en-US",
  };
  if (c.numberFormat) {
    opts.dataLabelFormatCode = c.numberFormat;
    opts.valAxisLabelFormatCode = c.numberFormat;
  }
  if (!pie) {
    Object.assign(opts, {
      catAxisLabelColor: theme.muted ?? theme.text,
      valAxisLabelColor: theme.muted ?? theme.text,
      catAxisLabelFontFace: font,
      valAxisLabelFontFace: font,
      catAxisLabelFontSize: 12,
      valAxisLabelFontSize: 11,
      valGridLine: { color: theme.grid ?? "D9D9D9", style: "solid", size: 0.5 },
      catAxisLineShow: false,
      valAxisLineShow: false,
    });
  }
  if (c.type === "bar" || c.type === "column") {
    opts.barDir = c.type === "bar" ? "bar" : "col";
    opts.barGrouping = c.stacked ? "stacked" : "clustered";
    opts.barGapWidthPct = 70;
    if (c.type === "bar") opts.catAxisOrientation = "maxMin";
  }
  if (c.type === "line") Object.assign(opts, { lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 8 });
  if (c.type === "doughnut") opts.holeSize = 55;
  const type = c.type === "column" ? "bar" : c.type;
  return { type, data: c.series.map((s) => ({ name: s.name, labels: c.categories, values: s.values })), opts };
}
