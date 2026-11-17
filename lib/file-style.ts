// The look of the files oovi makes (Excel, Word, PDF, HTML): a few colour themes, and how a sheet's columns
// are read (numbers typed as text become real numbers, with a format, an alignment and a width).
// Pure (no imports), so tests/unit/file-style.test.mts can run it directly.

export type FileTheme = {
  /** Header fill and rules. */
  accent: string;
  /** Headings and links: readable on white. */
  ink: string;
  /** Striped rows. */
  tint: string;
  /** Table lines. */
  line: string;
};

export const FILE_THEMES = {
  blue: { accent: "2F5BD3", ink: "1F3F99", tint: "F1F5FE", line: "D5DEF5" },
  green: { accent: "1E8A6B", ink: "14664F", tint: "EEF8F4", line: "CFE7DE" },
  warm: { accent: "C8612B", ink: "97441A", tint: "FCF4EC", line: "EFDCCB" },
  gray: { accent: "3D4654", ink: "2A313C", tint: "F4F5F7", line: "DCDFE4" },
} as const satisfies Record<string, FileTheme>;

export const FILE_THEME_NAMES = Object.keys(FILE_THEMES) as (keyof typeof FILE_THEMES)[];

export function fileTheme(name: unknown): FileTheme {
  return FILE_THEMES[(typeof name === "string" && name in FILE_THEMES ? name : "blue") as keyof typeof FILE_THEMES];
}

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LETTERS = /\p{L}/gu;

/** Mostly Arabic or Hebrew letters: the text reads right to left. */
export function mostlyRtl(text: string): boolean {
  const s = String(text ?? "").slice(0, 4000);
  const rtl = (s.match(RTL_CHARS) ?? []).length;
  if (!rtl) return false;
  const letters = (s.match(LETTERS) ?? []).length;
  return rtl * 2 >= letters;
}

export type SheetCell = string | number | boolean | null;
export type ColumnLook = {
  kind: "number" | "percent" | "text";
  /** Strings in this column are numbers typed as text: write them as numbers. */
  coerce: boolean;
  /** Excel number format ("" = none). */
  format: string;
  width: number;
  wrap: boolean;
};

// Columns that hold numbers nobody adds up: never reformatted, never turned into numbers.
const CODE_HEADER = /phone|num[ée]ro|t[ée]l|mobile|whats|fax|zip|postal|post\s?code|code|\bid\b|\bn[°o]\b|\bref|siret|siren|nif|nis|\brc\b|iban|rib|sku|barcode|isbn|هاتف|جوال|رقم|رمز|الرمز/i;
const YEAR_HEADER = /year|ann[ée]e|a[ñn]o|jahr|yıl|سنة|عام/i;
const PLAIN_NUMBER = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const PERCENT = /^-?\d+(?:[.,]\d+)?\s?%$/;

/** A number typed as text ("1,200", "3.5"), or null. "007", "+213…" and very long digit runs stay text. */
export function plainNumber(v: string): number | null {
  const s = v.trim();
  if (!PLAIN_NUMBER.test(s)) return null;
  const digits = s.replace(/[-,]/g, "");
  const whole = digits.split(".")[0]!;
  if (whole.length > 1 && whole.startsWith("0")) return null;
  if (whole.length >= 9 && !s.includes(",")) return null;
  if (digits.replace(".", "").length > 15) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function percentNumber(v: string): number | null {
  const s = v.trim();
  if (!PERCENT.test(s)) return null;
  const n = Number(s.replace(/\s?%$/, "").replace(",", "."));
  return Number.isFinite(n) ? n / 100 : null;
}

const isFormula = (v: SheetCell) => typeof v === "string" && v.startsWith("=");

/** How each column should look. Only the first `sample` rows are read for widths; types read every row. */
export function columnLooks(cols: string[], rows: SheetCell[][], given: string[] = [], sample = 2000): ColumnLook[] {
  const n = Math.max(cols.length, ...rows.slice(0, 50).map((r) => r.length), 0);
  const out: ColumnLook[] = [];
  for (let c = 0; c < n; c++) {
    const header = cols[c] ?? "";
    const code = CODE_HEADER.test(header);
    let numbers = 0;
    let numberStrings = 0;
    let percents = 0;
    let texts = 0;
    let decimals = false;
    let percentDecimals = false;
    let big = false;
    let yearLike = true;
    let width = header.length;
    let long = false;
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r]![c];
      if (v === null || v === undefined || v === "") continue;
      if (r < sample) {
        const len = isFormula(v) ? 12 : String(v).length;
        if (len > width) width = len;
        if (len > 60) long = true;
      }
      if (isFormula(v)) continue;
      let num: number | null = null;
      if (typeof v === "number") (numbers++, (num = v));
      else if (typeof v === "string" && !code) {
        num = plainNumber(v);
        if (num !== null) numberStrings++;
        else if (percentNumber(v) !== null) {
          percents++;
          if (/[.,]\d/.test(v)) percentDecimals = true;
        } else texts++;
      } else texts++;
      if (num !== null) {
        if (!Number.isInteger(num)) decimals = true;
        if (Math.abs(num) >= 1000) big = true;
        if (!Number.isInteger(num) || num < 1000 || num > 2999) yearLike = false;
      }
    }
    const allNumbers = !texts && !percents && numbers + numberStrings > 0;
    const allPercents = !texts && !numbers && !numberStrings && percents > 0;
    const asYear = allNumbers && (yearLike || YEAR_HEADER.test(header));
    const format = given[c] ? given[c]! : allPercents ? (percentDecimals ? "0.0%" : "0%") : allNumbers && !code && !asYear ? (decimals ? (big ? "#,##0.00" : "0.00") : big ? "#,##0" : "") : "";
    // A formatted number is wider than its digits (separators, decimals).
    const shown = allNumbers && format ? width + Math.floor(width / 3) + (decimals ? 1 : 0) : width;
    out.push({
      kind: allPercents ? "percent" : allNumbers ? "number" : "text",
      coerce: (allNumbers && numberStrings > 0) || allPercents,
      format,
      width: Math.min(60, Math.max(10, shown + 4)),
      wrap: long,
    });
  }
  return out;
}

/** The rows with numbers typed as text turned into numbers, in the columns that are numbers throughout. */
export function coerceRows(rows: SheetCell[][], looks: ColumnLook[]): SheetCell[][] {
  if (!looks.some((l) => l.coerce)) return rows;
  return rows.map((r) =>
    r.map((v, c) => {
      const l = looks[c];
      if (!l?.coerce || typeof v !== "string" || !v || v.startsWith("=")) return v;
      return (l.kind === "percent" ? percentNumber(v) : plainNumber(v)) ?? v;
    }),
  );
}

/** A cell that is just a web address (it becomes a link). */
export const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/[^\s<>"]{4,2000}$/i.test(v);

/** A1 column letters: 1 → A, 27 → AA. */
export function columnLetter(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
