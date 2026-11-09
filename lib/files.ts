// Real files the bots make: Word (.docx), Excel (.xlsx / .csv), PowerPoint (.pptx),
// PDF, Markdown, HTML and text — and reading Office files the user gives them.
//
// Files go into the chat's project folder when it has one (asks first, like any
// edit there), otherwise into the user's Downloads/oovi folder. Google Docs and
// Sheets open .docx / .xlsx directly, and a Drive connector can upload them.

import fs from "node:fs";
import path from "node:path";
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { marked, type Token, type Tokens } from "marked";
import PptxGenJS from "pptxgenjs";
import { downloadsDir, launchLocal } from "./browser";
import type { ToolSpec } from "./llm";
import type { BrowserConfig } from "./settings";
import type { ToolCall, ToolResult, Workspace } from "./types";
import { resolveInWorkspace } from "./workspace";

export const DOC_SPECS: ToolSpec[] = [
  {
    name: "create_document",
    description:
      "Create a real document file from Markdown: Word (.docx), PDF (.pdf), Markdown (.md), web page (.html) or text (.txt) — the file extension decides. Supports headings, bold/italic, links, bullet and numbered lists, tables, quotes and code. For Google Docs, create a .docx (Google Docs opens it).",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Quarterly report.docx'. In a project folder this can include a subfolder." },
        title: { type: "string", description: "Document title (shown at the top and in the file's properties)" },
        content: { type: "string", description: "The full content in Markdown" },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "create_spreadsheet",
    description:
      "Create a real spreadsheet: Excel (.xlsx, several sheets, formulas, number formats) or CSV (.csv, first sheet only). Values starting with '=' are formulas (e.g. '=SUM(B2:B10)'). Numbers must be numbers, not strings. For Google Sheets, create an .xlsx (Google Sheets opens it).",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Budget 2026.xlsx'" },
        sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              columns: { type: "array", items: { type: "string" }, description: "Header row" },
              rows: { type: "array", items: { type: "array", items: {} }, description: "Data rows: arrays of numbers, strings, booleans or null" },
              number_formats: { type: "array", items: { type: "string" }, description: "Optional Excel number format per column, e.g. '#,##0.00', '0%', 'yyyy-mm-dd', '\"$\"#,##0'" },
            },
            required: ["name", "columns", "rows"],
          },
        },
      },
      required: ["filename", "sheets"],
    },
  },
  {
    name: "create_presentation",
    description: "Create a real PowerPoint presentation (.pptx). Opens in PowerPoint, Keynote and Google Slides.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Pitch.pptx'" },
        title: { type: "string" },
        subtitle: { type: "string" },
        theme: { type: "string", enum: ["light", "dark", "blue", "warm"] },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              text: { type: "string", description: "A paragraph instead of (or after) bullets" },
              table: { type: "object", properties: { columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: {} } } } },
              notes: { type: "string", description: "Speaker notes" },
            },
            required: ["title"],
          },
        },
      },
      required: ["filename", "title", "slides"],
    },
  },
  {
    name: "read_document",
    description: "Read the text of a Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, Markdown or text file in the project folder or in Downloads/oovi.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

export const DOC_TOOLS: ReadonlySet<string> = new Set(DOC_SPECS.map((s) => s.name));
/** Writing into a project folder asks like any other edit there. */
export const DOC_WRITE_TOOLS: ReadonlySet<string> = new Set(["create_document", "create_spreadsheet", "create_presentation"]);

const MAX_TEXT = 400_000;

// ---------- where files go ----------

function cleanName(name: string, fallbackExt: string): string {
  let n = String(name || "").trim().replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^[\\/]+/, "");
  if (!n) n = `oovi file${fallbackExt}`;
  if (!path.extname(n)) n += fallbackExt;
  return n.slice(0, 180);
}

/** Absolute output path: inside the project folder, or a new file in Downloads/oovi. */
function outputPath(filename: string, ws: Workspace | undefined, fallbackExt: string): { abs: string; shown: string } {
  const name = cleanName(filename, fallbackExt);
  if (ws) {
    const { abs, rel } = resolveInWorkspace(ws, name);
    return { abs, shown: rel };
  }
  const dir = downloadsDir();
  const base = path.basename(name.replace(/\\/g, "/"));
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let abs = path.join(dir, base);
  for (let i = 2; fs.existsSync(abs); i++) abs = path.join(dir, `${stem} (${i})${ext}`);
  return { abs, shown: abs };
}

function done(call: ToolCall, abs: string, shown: string, what: string): ToolResult {
  const size = fs.statSync(abs).size;
  return {
    id: call.id,
    name: call.name,
    content: `Created ${what}: ${shown} (${size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`}). The user can open it from the chat.`,
    file: { path: abs, name: path.basename(abs), size },
  };
}

// ---------- Markdown -> Word ----------

type Run = TextRun | ExternalHyperlink;
type Style = { bold?: boolean; italics?: boolean };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function inlineRuns(tokens: Token[] | undefined, style: Style = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "codespan":
        out.push(new TextRun({ text: decode((t as Tokens.Codespan).text), font: "Consolas", bold: style.bold, italics: style.italics }));
        break;
      case "link": {
        const l = t as Tokens.Link;
        out.push(new ExternalHyperlink({ link: l.href, children: [new TextRun({ text: decode(l.text), style: "Hyperlink", bold: style.bold, italics: style.italics })] }));
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      default: {
        const anyT = t as Tokens.Text;
        if ("tokens" in anyT && anyT.tokens?.length) out.push(...inlineRuns(anyT.tokens, style));
        else out.push(new TextRun({ text: decode(anyT.text ?? anyT.raw ?? ""), bold: style.bold, italics: style.italics }));
      }
    }
  }
  return out;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function blocks(tokens: Token[], listLevel = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        out.push(new Paragraph({ heading: HEADINGS[Math.min(5, h.depth - 1)], children: inlineRuns(h.tokens) }));
        break;
      }
      case "paragraph":
        out.push(new Paragraph({ children: inlineRuns((t as Tokens.Paragraph).tokens), spacing: { after: 120 } }));
        break;
      case "list": {
        const l = t as Tokens.List;
        for (const item of l.items) {
          const [first, ...rest] = item.tokens;
          const runs = first && "tokens" in first && first.tokens ? inlineRuns(first.tokens) : first ? inlineRuns([first]) : [];
          out.push(
            new Paragraph({
              children: item.task ? [new TextRun(item.checked ? "☑ " : "☐ "), ...runs] : runs,
              ...(l.ordered ? { numbering: { reference: "numbers", level: Math.min(listLevel, 8) } } : { bullet: { level: Math.min(listLevel, 8) } }),
            }),
          );
          for (const r of rest) out.push(...blocks([r], r.type === "list" ? listLevel + 1 : listLevel));
        }
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        const cell = (tokens: Token[], header: boolean) =>
          new TableCell({
            children: [new Paragraph({ children: inlineRuns(tokens, header ? { bold: true } : {}) })],
            ...(header ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "EDEBE6" } } : {}),
          });
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ tableHeader: true, children: tb.header.map((h) => cell(h.tokens, true)) }), ...tb.rows.map((r) => new TableRow({ children: r.map((c) => cell(c.tokens, false)) }))],
          }),
        );
        out.push(new Paragraph({ text: "" }));
        break;
      }
      case "code":
        for (const line of (t as Tokens.Code).text.split("\n")) {
          out.push(new Paragraph({ children: [new TextRun({ text: line || " ", font: "Consolas", size: 19 })], shading: { type: ShadingType.CLEAR, color: "auto", fill: "F4F3EF" } }));
        }
        break;
      case "blockquote":
        for (const b of blocks((t as Tokens.Blockquote).tokens, listLevel)) out.push(b instanceof Paragraph ? b : b);
        break;
      case "hr":
        out.push(new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } } }));
        break;
      case "space":
        break;
      default:
        if ("text" in t && typeof t.text === "string" && t.text.trim()) out.push(new Paragraph({ text: decode(t.text) }));
    }
  }
  return out;
}

async function toDocx(markdown: string, title?: string): Promise<Buffer> {
  const body = blocks(marked.lexer(markdown));
  const doc = new Document({
    creator: "oovi",
    title: title || undefined,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "numbers",
          levels: Array.from({ length: 9 }, (_, i) => ({ level: i, format: LevelFormat.DECIMAL, text: `%${i + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } })),
        },
      ],
    },
    sections: [{ children: [...(title ? [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })] : []), ...body] }],
  });
  return Packer.toBuffer(doc);
}

// ---------- Markdown -> HTML / PDF ----------

const PRINT_CSS = `body{font:11pt/1.55 "Segoe UI",-apple-system,Helvetica,Arial,sans-serif;color:#1b1b1b;max-width:760px;margin:0 auto;padding:24px}
h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:22pt}h2{font-size:16pt}h3{font-size:13pt}
table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d9d6cf;padding:6px 8px;text-align:left;vertical-align:top}th{background:#efede8}
code{font-family:Consolas,monospace;background:#f4f3ef;padding:1px 4px;border-radius:4px}pre{background:#f4f3ef;padding:10px 12px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:12px 0;padding:4px 14px;border-left:3px solid #ccc;color:#555}a{color:#1a5fd1}img{max-width:100%}`;

function toHtml(markdown: string, title?: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  const body = marked.parse(markdown, { async: false }) as string;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || "Document")}</title><style>${PRINT_CSS}</style></head><body>${title ? `<h1>${esc(title)}</h1>` : ""}${body}</body></html>`;
}

async function toPdf(html: string, browser: BrowserConfig): Promise<Buffer> {
  const b = await launchLocal(browser.channel);
  try {
    const page = await b.newPage();
    // No network: the document is self-contained.
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" } });
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------- spreadsheets ----------

type Cell = string | number | boolean | null;
type SheetIn = { name?: unknown; columns?: unknown; rows?: unknown; number_formats?: unknown };

function asCells(row: unknown): Cell[] {
  return (Array.isArray(row) ? row : [row]).slice(0, 200).map((v) => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 32_000)));
}

async function toXlsx(sheets: SheetIn[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "oovi";
  const used = new Set<string>();
  for (const [i, s] of sheets.slice(0, 30).entries()) {
    let name = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${i + 1}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const cols = asCells(s.columns).map((c) => String(c ?? ""));
    const formats = Array.isArray(s.number_formats) ? s.number_formats.map((f) => (typeof f === "string" ? f.slice(0, 60) : "")) : [];
    ws.addRow(cols).eachCell((c) => {
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEDE8" } };
    });
    const rows = Array.isArray(s.rows) ? s.rows.slice(0, 100_000) : [];
    for (const r of rows) {
      const row = ws.addRow(asCells(r).map((v) => (typeof v === "string" && v.startsWith("=") ? { formula: v.slice(1) } : v)));
      row.eachCell((c, col) => {
        if (formats[col - 1]) c.numFmt = formats[col - 1]!;
      });
    }
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    ws.columns.forEach((col, ci) => {
      let w = (cols[ci] ?? "").length;
      col.eachCell?.({ includeEmpty: false }, (c) => {
        const v = c.value;
        const len = v && typeof v === "object" && "formula" in v ? 12 : String(v ?? "").length;
        if (len > w) w = len;
      });
      col.width = Math.min(60, Math.max(8, w + 2));
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toCsv(sheet: SheetIn): string {
  const cell = (v: Cell) => {
    const s = v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [asCells(sheet.columns), ...(Array.isArray(sheet.rows) ? sheet.rows : []).map(asCells)].map((r) => r.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- presentations ----------

const THEMES = {
  light: { bg: "FFFFFF", title: "1B1B1B", text: "333333", accent: "4F6BED" },
  dark: { bg: "1E1E1C", title: "F2F2EE", text: "D8D6CF", accent: "9EB4FF" },
  blue: { bg: "0F2A5C", title: "FFFFFF", text: "DCE6FF", accent: "FDCB52" },
  warm: { bg: "FBF7EF", title: "3A2A1A", text: "4A3B2C", accent: "E07A3F" },
} as const;

type SlideIn = { title?: unknown; bullets?: unknown; text?: unknown; table?: { columns?: unknown; rows?: unknown }; notes?: unknown };

async function toPptx(title: string, subtitle: string, themeName: string, slides: SlideIn[]): Promise<Buffer> {
  const th = THEMES[(themeName in THEMES ? themeName : "light") as keyof typeof THEMES];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "oovi";
  pptx.title = title;
  const cover = pptx.addSlide();
  cover.background = { color: th.bg };
  cover.addShape("rect", { x: 0.6, y: 3.05, w: 1.2, h: 0.08, fill: { color: th.accent }, line: { color: th.accent } });
  cover.addText(title, { x: 0.6, y: 1.6, w: 12, h: 1.4, fontSize: 40, bold: true, color: th.title, fontFace: "Calibri" });
  if (subtitle) cover.addText(subtitle, { x: 0.6, y: 3.3, w: 12, h: 0.8, fontSize: 20, color: th.text, fontFace: "Calibri" });
  for (const s of slides.slice(0, 80)) {
    const sl = pptx.addSlide();
    sl.background = { color: th.bg };
    sl.addText(String(s.title ?? "").slice(0, 200), { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontSize: 30, bold: true, color: th.title, fontFace: "Calibri" });
    sl.addShape("rect", { x: 0.6, y: 1.22, w: 0.9, h: 0.06, fill: { color: th.accent }, line: { color: th.accent } });
    let y = 1.5;
    const bullets = Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 500)).slice(0, 12) : [];
    if (bullets.length) {
      const h = Math.min(5.2, 0.5 * bullets.length + 0.3);
      sl.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y, w: 11.9, h, fontSize: bullets.length > 7 ? 16 : 20, color: th.text, fontFace: "Calibri", valign: "top", paraSpaceAfter: 6 },
      );
      y += h + 0.1;
    }
    if (typeof s.text === "string" && s.text.trim()) {
      sl.addText(s.text.slice(0, 2000), { x: 0.7, y, w: 11.9, h: Math.max(0.8, 6.8 - y), fontSize: 18, color: th.text, fontFace: "Calibri", valign: "top" });
      y += 1.2;
    }
    const tb = s.table;
    if (tb && Array.isArray(tb.columns) && Array.isArray(tb.rows)) {
      const head = tb.columns.map((c) => ({ text: String(c), options: { bold: true, fill: { color: th.accent }, color: th.bg } }));
      const rows = tb.rows.slice(0, 15).map((r) => asCells(r).map((c) => ({ text: c === null ? "" : String(c) })));
      sl.addTable([head, ...rows], { x: 0.7, y: Math.min(y, 5), w: 11.9, fontSize: 14, color: th.text, border: { type: "solid", pt: 0.5, color: "BBBBBB" }, autoPage: false });
    }
    if (typeof s.notes === "string" && s.notes.trim()) sl.addNotes(s.notes.slice(0, 5000));
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

// ---------- reading Office files ----------

const stripXml = (xml: string) =>
  xml
    .replace(/<\/w:p>|<\/a:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function readDocument(abs: string): Promise<string> {
  const ext = path.extname(abs).toLowerCase();
  if ([".txt", ".md", ".csv", ".json", ".html", ".htm", ".tsv"].includes(ext)) return fs.readFileSync(abs, "utf8").slice(0, MAX_TEXT);
  if (ext === ".docx") {
    const zip = await JSZip.loadAsync(fs.readFileSync(abs));
    return stripXml((await zip.file("word/document.xml")?.async("string")) ?? "").slice(0, MAX_TEXT);
  }
  if (ext === ".pptx") {
    const zip = await JSZip.loadAsync(fs.readFileSync(abs));
    const slides = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    const out: string[] = [];
    for (const [i, f] of slides.entries()) out.push(`--- Slide ${i + 1} ---\n${stripXml((await zip.file(f)?.async("string")) ?? "")}`);
    return out.join("\n\n").slice(0, MAX_TEXT);
  }
  if (ext === ".xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(abs);
    const out: string[] = [];
    wb.eachSheet((ws) => {
      out.push(`--- Sheet: ${ws.name} (${ws.rowCount} rows) ---`);
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        if (n > 2000) return;
        const vals = (row.values as unknown[]).slice(1).map((v) => {
          if (v && typeof v === "object") {
            const o = v as { result?: unknown; text?: unknown; formula?: string };
            return String(o.result ?? o.text ?? (o.formula ? `=${o.formula}` : ""));
          }
          return v === undefined || v === null ? "" : String(v);
        });
        out.push(vals.join("\t"));
      });
    });
    return out.join("\n").slice(0, MAX_TEXT);
  }
  throw new Error(`oovi can read .docx, .xlsx, .pptx, .csv, .md and .txt files, not ${ext || "this file"}.`);
}

// ---------- run ----------

export async function runDocTool(call: ToolCall, ws: Workspace | undefined, browser: BrowserConfig): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const i = call.input;
  try {
    if (call.name === "read_document") {
      const p = String(i.path ?? "").trim();
      let abs: string;
      if (ws) abs = resolveInWorkspace(ws, p).abs;
      else {
        const dir = downloadsDir();
        abs = path.resolve(dir, p);
        const rel = path.relative(dir, abs);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return fail("Without a project folder, bots can only read files in Downloads/oovi.");
      }
      if (!fs.existsSync(abs)) return fail(`${p} doesn't exist.`);
      const text = await readDocument(abs);
      return { id: call.id, name: call.name, content: `${path.basename(abs)}:\n${text || "(no text)"}` };
    }

    const filename = String(i.filename ?? "");
    if (call.name === "create_document") {
      const content = String(i.content ?? "");
      if (!content.trim()) return fail("content is required");
      if (content.length > MAX_TEXT) return fail("That's too long for one document. Split it into parts.");
      const title = typeof i.title === "string" ? i.title.slice(0, 200) : undefined;
      const { abs, shown } = outputPath(filename, ws, ".docx");
      const ext = path.extname(abs).toLowerCase();
      if (![".docx", ".pdf", ".html", ".htm", ".md", ".txt"].includes(ext)) return fail(`create_document makes .docx, .pdf, .md, .html or .txt files, not ${ext}.`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (ext === ".docx") fs.writeFileSync(abs, await toDocx(content, title));
      else if (ext === ".pdf") fs.writeFileSync(abs, await toPdf(toHtml(content, title), browser));
      else if (ext === ".html" || ext === ".htm") fs.writeFileSync(abs, toHtml(content, title));
      else fs.writeFileSync(abs, title && ext === ".md" ? `# ${title}\n\n${content}` : content);
      return done(call, abs, shown, ext === ".docx" ? "a Word document" : ext === ".pdf" ? "a PDF" : "a document");
    }

    if (call.name === "create_spreadsheet") {
      const sheets = Array.isArray(i.sheets) ? (i.sheets as SheetIn[]) : [];
      if (!sheets.length) return fail("Give at least one sheet with columns and rows.");
      const { abs, shown } = outputPath(filename, ws, ".xlsx");
      const ext = path.extname(abs).toLowerCase();
      if (ext !== ".xlsx" && ext !== ".csv") return fail(`create_spreadsheet makes .xlsx or .csv files, not ${ext}.`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (ext === ".xlsx") fs.writeFileSync(abs, await toXlsx(sheets));
      else fs.writeFileSync(abs, toCsv(sheets[0]!));
      return done(call, abs, shown, ext === ".xlsx" ? "an Excel workbook" : "a CSV file");
    }

    if (call.name === "create_presentation") {
      const slides = Array.isArray(i.slides) ? (i.slides as SlideIn[]) : [];
      if (!slides.length) return fail("Give at least one slide.");
      const { abs, shown } = outputPath(filename, ws, ".pptx");
      if (path.extname(abs).toLowerCase() !== ".pptx") return fail("create_presentation makes .pptx files.");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, await toPptx(String(i.title ?? "Presentation").slice(0, 200), String(i.subtitle ?? "").slice(0, 300), String(i.theme ?? "light"), slides));
      return done(call, abs, shown, "a PowerPoint presentation");
    }
    return fail(`Unknown tool: ${call.name}`);
  } catch (e) {
    return fail((e as Error).message || String(e));
  }
}

/** What the approval card shows when a bot creates a file inside a project folder. */
export function describeDocCall(call: ToolCall, ws: Workspace | undefined): { summary: string; detail?: string } {
  const name = String(call.input.filename ?? "file");
  const where = ws ? path.basename(ws.path) : "Downloads/oovi";
  if (call.name === "create_document") return { summary: `Create ${name} in ${where}`, detail: String(call.input.content ?? "").slice(0, 4000) };
  if (call.name === "create_spreadsheet") return { summary: `Create the spreadsheet ${name} in ${where}` };
  return { summary: `Create the presentation ${name} in ${where}` };
}
