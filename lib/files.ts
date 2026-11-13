// Real files the bots make: Word (.docx), Excel (.xlsx / .csv), PowerPoint (.pptx),
// PDF, Markdown, HTML and text — and reading Office files the user gives them.
//
// Files go into the chat's project folder when it has one (asks first, like any
// edit there), otherwise into the user's Downloads/oovi folder. Google Docs and
// Sheets open .docx / .xlsx directly, and a Drive connector can upload them.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { marked, type Token, type Tokens } from "marked";
import PptxGenJS from "pptxgenjs";
import { downloadsDir, launchLocal, saveFolderLabel } from "./browser";
import { cardHtml, normalizeCard, onColor, PALETTES } from "./card";
import { chartAnchor, chartDataRows, CHART_KINDS, injectXlsxCharts, inlineXlsxChart, isRtlText, normalizeChart, pptxChart, resolveRangeChart, type ChartData, type SheetData, type XlsxChart, type ZipIO } from "./charts";
import type { ToolSpec } from "./llm";
import { fitContain, orientationFor, type Orientation } from "./media";
import { aiPhoto, aiPhotoProvider, findPhoto, loadLocalPicture, pictureDataUri, renderHtml, resolveInDownloads, type Picture } from "./render";
import { dataDir, type BrowserConfig } from "./settings";
import type { ToolCall, ToolResult, Workspace } from "./types";
import { resolveInWorkspace } from "./workspace";
import { translateFor, type Tr } from "./i18n-server";

const CHART_INLINE = {
  type: "object",
  description: "A native chart with its numbers, e.g. {type:'column', title:'Sales', categories:['Jan','Feb'], series:[{name:'2026', values:[120, 150]}]}",
  properties: {
    type: { type: "string", enum: [...CHART_KINDS], description: "column = vertical bars, bar = horizontal bars" },
    title: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
    series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } } },
    stacked: { type: "boolean" },
    show_values: { type: "boolean" },
    number_format: { type: "string", description: "Excel-style, e.g. '#,##0', '0%'" },
  },
};

const IMAGE_REF = {
  type: "object",
  description: "A picture: {search:'coffee shop interior'} finds a free photo (credited on the slide), or {path:'Facebook post.png'} uses a picture in the project folder or Downloads/oovi",
  properties: {
    search: { type: "string", description: "Free photo to look for (English keywords work best)" },
    path: { type: "string" },
    caption: { type: "string" },
  },
};

export const DOC_SPECS: ToolSpec[] = [
  {
    name: "create_document",
    description:
      "Create a real document file from Markdown: Word (.docx), PDF (.pdf), Markdown (.md), web page (.html) or text (.txt) — the file extension decides. Supports headings, bold/italic, links, bullet and numbered lists, tables, quotes and code. For Google Docs, create a .docx (Google Docs opens it). A long document (a report, a thesis chapter, more than about 2,500 words) is written in parts, never in one call: the first call with the title and the first sections, then the same filename with append: true and the next sections, a few per call, until it's complete. The file is rebuilt complete after each part. Code and configuration files (.py, .js, .toml, .json, .env.example, .gitignore…) are not documents: they go in a project folder with write_file (ask for the folder with use_project_folder).",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Quarterly report.docx'. In a project folder this can include a subfolder." },
        title: { type: "string", description: "Document title (shown at the top and in the file's properties)" },
        content: { type: "string", description: "The content in Markdown (with append: the next sections only)" },
        append: { type: "boolean", description: "true: add this content at the end of the document you already made with this filename in this chat (the title stays)." },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "create_spreadsheet",
    description:
      "Create a real spreadsheet: Excel (.xlsx, several sheets, formulas, number formats, native charts) or CSV (.csv, first sheet only). Values starting with '=' are formulas (e.g. '=SUM(B2:B10)'). Numbers must be numbers, not strings. Add charts to a sheet with `charts`: they are real Excel charts linked to the cells, so they update when the numbers change. For Google Sheets, create an .xlsx (Google Sheets opens it).",
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
              charts: {
                type: "array",
                description: "Optional charts on this sheet (.xlsx only), drawn from this sheet's columns. Defaults: first column = labels, every numeric column = a series, all data rows (a final 'Total' row is skipped).",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: [...CHART_KINDS], description: "column = vertical bars, bar = horizontal bars, line, area, pie, doughnut" },
                    title: { type: "string" },
                    category_column: { type: "string", description: "Header name or letter of the labels column (default: the first column)" },
                    value_columns: { type: "array", items: { type: "string" }, description: "Header names or letters of the number columns to plot (default: all numeric columns; pie uses the first)" },
                    first_row: { type: "number", description: "First sheet row to plot (default 2, the first data row)" },
                    last_row: { type: "number", description: "Last sheet row to plot (default: the last data row)" },
                    anchor: { type: "string", description: "Cell where the chart's top-left corner goes, e.g. 'H2' (default: right of the data)" },
                    stacked: { type: "boolean" },
                    show_values: { type: "boolean", description: "Show the numbers on the chart (pie: percentages)" },
                    categories: { type: "array", items: { type: "string" }, description: "Only for numbers that aren't in the sheet: labels (with series). They're written to a 'Chart data' sheet." },
                    series: { type: "array", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } } }, description: "Only with categories" },
                  },
                },
              },
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
    description:
      "Create a real PowerPoint presentation (.pptx) with a designed title slide, native charts and pictures. Opens in PowerPoint, Keynote and Google Slides. Make it visual: give slides with numbers a `chart`, and add an `image` to a few slides (a free photo found by `search`, or a picture made with create_image or in the project folder). Arabic text is laid out right-to-left automatically.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Pitch.pptx'" },
        title: { type: "string" },
        subtitle: { type: "string" },
        theme: { type: "string", enum: ["light", "dark", "blue", "warm"] },
        cover_image: IMAGE_REF,
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              layout: { type: "string", enum: ["content", "section"], description: "section = a divider slide between parts (title + optional text)" },
              bullets: { type: "array", items: { type: "string" } },
              text: { type: "string", description: "A paragraph instead of (or after) bullets" },
              table: { type: "object", properties: { columns: { type: "array", items: { type: "string" } }, rows: { type: "array", items: { type: "array", items: {} } } } },
              chart: CHART_INLINE,
              image: IMAGE_REF,
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
    name: "create_image",
    description:
      "Design a finished picture (PNG) from text, colors and an optional photo: a social media post, poster/flyer, quote card or simple infographic (stats, steps or a small chart). Use it whenever the user wants an image, visual, graphic, flyer or a picture for a post (Facebook, Instagram, WhatsApp status, story...). Arabic and Hebrew are laid out right-to-left automatically. Keep the text short: a headline plus a few words. The photo can be a free photo (`photo.search`, English keywords work best), a picture in the project folder or Downloads/oovi (`photo.path`), or an AI-generated photo (`photo.ai_prompt`, only when the user added an OpenAI or Gemini key; it costs them a little).",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "e.g. 'Facebook post.png' (.png or .jpg)" },
        style: { type: "string", enum: ["post", "poster", "quote", "infographic"], description: "post (default): headline + short text; poster: big centered headline, photo on top; quote: a quotation, author in subheadline; infographic: big stat figures, a timeline of steps, or a chart, with icons" },
        size: { type: "string", enum: ["square", "portrait", "landscape", "story"], description: "square 1080x1080 (Facebook/Instagram post, default), portrait 1080x1350 (Instagram), landscape 1920x1080 (slides, YouTube, X), story 1080x1920 (stories, reels, WhatsApp status)" },
        headline: { type: "string", description: "The main text (short)" },
        subheadline: { type: "string", description: "Second line; for quotes, the author" },
        body: { type: "string", description: "Optional short paragraph" },
        points: { type: "array", items: { type: "object", properties: { value: { type: "string", description: "e.g. '45%', '3x', '120 DA' for a stat, or a step's short title ('Plan', 'Launch') (optional)" }, label: { type: "string" }, icon: { type: "string", description: "One emoji for this point, e.g. '☕' (optional; infographics show it in a circle)" } } }, description: "Up to 8: bullet points, steps, menu items, or stats. Infographic: every value a number makes big stat figures; otherwise the points are a timeline of steps (across the image when it's wide)." },
        chart: CHART_INLINE,
        cta: { type: "string", description: "Call-to-action button, e.g. 'Order now'" },
        badge: { type: "string", description: "Small tag at the top, e.g. 'NEW', '-20%'" },
        footer: { type: "string", description: "Brand name, website, phone or address at the bottom" },
        palette: { type: "string", enum: Object.keys(PALETTES), description: "Color set (default warm)" },
        colors: { type: "object", properties: { background: { type: "string" }, text: { type: "string" }, accent: { type: "string" } }, description: "Hex colors like '#C0392B' (override the palette, e.g. brand colors)" },
        photo: {
          type: "object",
          properties: {
            search: { type: "string", description: "Free photo to look for, e.g. 'latte art coffee cup'" },
            path: { type: "string", description: "A picture in the project folder or Downloads/oovi" },
            ai_prompt: { type: "string", description: "Describe a photo to generate with the user's own OpenAI/Gemini key (no text in it)" },
          },
        },
        photo_layout: { type: "string", enum: ["background", "top", "side"], description: "Where the photo goes (default depends on style and size)" },
        align: { type: "string", enum: ["start", "center"] },
      },
      required: ["filename", "headline"],
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
export const DOC_WRITE_TOOLS: ReadonlySet<string> = new Set(["create_document", "create_spreadsheet", "create_presentation", "create_image"]);

const MAX_TEXT = 400_000;

// ---------- where files go ----------

function cleanName(name: string, fallbackExt: string): string {
  let n = String(name || "").trim().replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^[\\/]+/, "");
  if (!n) n = `oovi file${fallbackExt}`;
  if (!path.extname(n)) n += fallbackExt;
  return n.slice(0, 180);
}

const DOC_EXTS = [".docx", ".pdf", ".html", ".htm", ".md", ".txt"];

/** A document's Markdown, kept beside oovi's data so a document made in parts can be rebuilt complete. */
type DocSource = { title?: string; md: string };
const docSourceFile = (abs: string) => path.join(dataDir(), "doc-sources", `${crypto.createHash("sha1").update(path.resolve(abs)).digest("hex")}.json`);
function readDocSource(abs: string): DocSource | null {
  try {
    const j = JSON.parse(fs.readFileSync(docSourceFile(abs), "utf8")) as DocSource & { size?: number };
    // The file was changed or replaced since (by the user or another tool): its text can't be extended safely.
    if (typeof j.size === "number" && fs.statSync(abs).size !== j.size) return null;
    return typeof j.md === "string" ? { title: j.title, md: j.md } : null;
  } catch {
    return null;
  }
}
function writeDocSource(abs: string, src: DocSource): void {
  try {
    const dir = path.dirname(docSourceFile(abs));
    fs.mkdirSync(dir, { recursive: true });
    // Documents are made in parts within a task: sources older than a month are of no use any more.
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < old) fs.rmSync(p, { force: true });
    }
    fs.writeFileSync(docSourceFile(abs), JSON.stringify({ ...src, size: fs.statSync(abs).size }));
  } catch {
    // Without it, a later append asks for a new document: nothing else depends on it.
  }
}

/** The file a bot named, where it would have been created: inside the project folder, or in Downloads/oovi. */
function existingOutput(filename: string, ws: Workspace | undefined): { abs: string; shown: string } | null {
  const name = cleanName(filename, ".docx");
  if (ws) {
    const { abs, rel } = resolveInWorkspace(ws, name);
    return fs.existsSync(abs) ? { abs, shown: rel } : null;
  }
  const abs = path.join(downloadsDir(), path.basename(name.replace(/\\/g, "/")));
  return fs.existsSync(abs) ? { abs, shown: abs } : null;
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

/** Save bytes made elsewhere (e.g. on the cloud computer) where documents go, and show it in the chat. */
export function saveOutput(call: ToolCall, filename: string, ws: Workspace | undefined, data: Buffer, what: string): ToolResult {
  const { abs, shown } = outputPath(filename, ws, path.extname(filename) || ".bin");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  return done(call, abs, shown, what);
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
type SheetIn = { name?: unknown; columns?: unknown; rows?: unknown; number_formats?: unknown; charts?: unknown };

function asCells(row: unknown): Cell[] {
  return (Array.isArray(row) ? row : [row]).slice(0, 200).map((v) => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 32_000)));
}

const MAX_CHARTS = 20;

function fillSheet(ws: ExcelJS.Worksheet, cols: string[], rows: Cell[][], formats: string[]) {
  ws.addRow(cols).eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEDE8" } };
  });
  for (const r of rows) {
    const row = ws.addRow(r.map((v) => (typeof v === "string" && v.startsWith("=") ? { formula: v.slice(1) } : v)));
    row.eachCell((c, col) => {
      if (formats[col - 1]) c.numFmt = formats[col - 1]!;
    });
  }
}

function sizeColumns(ws: ExcelJS.Worksheet, cols: string[]) {
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

const isInlineChart = (r: Record<string, unknown>) => Array.isArray(r.categories) || Array.isArray(r.labels) || (Array.isArray(r.series) && r.series.some((x) => !!x && typeof x === "object" && Array.isArray((x as { values?: unknown }).values)));

/** Workbook bytes, with native charts written into the file after exceljs (which can't make charts). */
async function toXlsx(sheets: SheetIn[]): Promise<{ data: Buffer; charts: number }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "oovi";
  const used = new Set<string>();
  const uniqueName = (raw: string, i: number) => {
    let name = raw.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 27)} ${i + 1}`;
    used.add(name.toLowerCase());
    return name;
  };
  const written: SheetData[] = [];
  for (const [i, s] of sheets.slice(0, 30).entries()) {
    const name = uniqueName(String(s.name || `Sheet${i + 1}`), i);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    const cols = asCells(s.columns).map((c) => String(c ?? ""));
    const formats = Array.isArray(s.number_formats) ? s.number_formats.map((f) => (typeof f === "string" ? f.slice(0, 60) : "")) : [];
    const rows = (Array.isArray(s.rows) ? s.rows.slice(0, 100_000) : []).map(asCells);
    fillSheet(ws, cols, rows, formats);
    if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    sizeColumns(ws, cols);
    written.push({ name, columns: cols, rows });
  }

  // Charts: over the sheet's own cells, or over inline numbers written to a "Chart data" sheet.
  const bySheet: { sheet: number; charts: XlsxChart[] }[] = [];
  const inline: { sheet: number; chart: ChartData; anchor: XlsxChart["anchor"] }[] = [];
  let count = 0;
  for (const [i, s] of sheets.slice(0, 30).entries()) {
    const list = Array.isArray(s.charts) ? s.charts : [];
    const sheet = written[i]!;
    const charts: XlsxChart[] = [];
    for (const [k, raw] of list.entries()) {
      if (++count > MAX_CHARTS) throw new Error(`At most ${MAX_CHARTS} charts per workbook.`);
      if (!raw || typeof raw !== "object") throw new Error(`Chart ${k + 1} on "${sheet.name}" must be an object.`);
      const r = raw as Record<string, unknown>;
      const anchor = chartAnchor(r.anchor, sheet, k);
      if (isInlineChart(r)) {
        const c = normalizeChart(r);
        if (typeof c === "string") throw new Error(`Chart ${k + 1} on "${sheet.name}": ${c}`);
        inline.push({ sheet: i, chart: c, anchor });
      } else {
        const c = resolveRangeChart(r, sheet);
        if (typeof c === "string") throw new Error(`Chart ${k + 1} on "${sheet.name}": ${c}`);
        charts.push({ ...c, anchor });
      }
    }
    bySheet.push({ sheet: i, charts });
  }
  if (inline.length) {
    const name = uniqueName("Chart data", written.length);
    const ws = wb.addWorksheet(name);
    let row = 1;
    for (const it of inline) {
      const rows = chartDataRows(it.chart);
      rows.forEach((r, j) => {
        const added = ws.addRow(r);
        if (j === 0) added.font = { bold: true };
        else if (it.chart.numberFormat) added.eachCell((c, col) => void (col > 1 && (c.numFmt = it.chart.numberFormat!)));
      });
      bySheet[it.sheet]!.charts.push(inlineXlsxChart(it.chart, name, row, it.anchor));
      row += rows.length + 1;
      ws.addRow([]);
    }
    sizeColumns(ws, []);
  }

  let data: Buffer = Buffer.from(await wb.xlsx.writeBuffer());
  let made = 0;
  if (bySheet.some((b) => b.charts.length)) {
    const zip = await JSZip.loadAsync(data);
    const io: ZipIO = {
      read: async (p) => (await zip.file(p)?.async("string")) ?? null,
      write: (p, d) => void zip.file(p, d),
      list: () => Object.keys(zip.files),
    };
    made = await injectXlsxCharts(io, bySheet);
    data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
  return { data, charts: made };
}

function toCsv(sheet: SheetIn): string {
  const cell = (v: Cell) => {
    const s = v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [asCells(sheet.columns), ...(Array.isArray(sheet.rows) ? sheet.rows : []).map(asCells)].map((r) => r.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- pictures for slides ----------

type SlidePicture = { pic: Picture; caption: string; credit?: string };

/** A slide picture from {path} or {search}. Never throws: a missing photo is a note, not a failure. */
async function slidePicture(ref: unknown, ws: Workspace | undefined, orientation: Orientation): Promise<{ picture?: SlidePicture; note?: string }> {
  if (!ref) return {};
  const r: Record<string, unknown> = typeof ref === "string" ? (/\.(png|jpe?g|gif|webp)$/i.test(ref.trim()) ? { path: ref } : { search: ref }) : typeof ref === "object" ? (ref as Record<string, unknown>) : {};
  const caption = typeof r.caption === "string" ? r.caption.trim().slice(0, 200) : "";
  if (typeof r.path === "string" && r.path.trim()) {
    try {
      const pic = loadLocalPicture(r.path, ws);
      if (pic.info.kind === "webp") return { note: `${r.path}: PowerPoint can't show WebP pictures; use PNG or JPEG.` };
      return { picture: { pic, caption } };
    } catch (e) {
      return { note: (e as Error).message };
    }
  }
  if (typeof r.search === "string" && r.search.trim()) {
    const found = await findPhoto(r.search, orientation);
    if (found.picture) return { picture: { pic: found.picture, caption, credit: found.picture.credit } };
    return { note: `No free photo added for "${r.search.slice(0, 60)}" (${found.error ?? "not found"}).` };
  }
  return {};
}

// ---------- presentations ----------

const THEMES = {
  light: { bg: "FFFFFF", title: "1B1B1B", text: "333333", accent: "4F6BED", muted: "6B6B6B", grid: "E3E3E3" },
  dark: { bg: "1E1E1C", title: "F2F2EE", text: "D8D6CF", accent: "9EB4FF", muted: "A09E97", grid: "3A3A37" },
  blue: { bg: "0F2A5C", title: "FFFFFF", text: "DCE6FF", accent: "FDCB52", muted: "A9B8DD", grid: "2A4677" },
  warm: { bg: "FBF7EF", title: "3A2A1A", text: "4A3B2C", accent: "E07A3F", muted: "8A7A68", grid: "E8DFD0" },
} as const;

type SlideIn = { title?: unknown; layout?: unknown; bullets?: unknown; text?: unknown; table?: { columns?: unknown; rows?: unknown }; chart?: unknown; image?: unknown; notes?: unknown };
type Box = { x: number; y: number; w: number; h: number };

const SW = 13.333;
const SH = 7.5;
const MARGIN = 0.6;
const FONT = "Calibri";
const MAX_SLIDE_PICTURES = 12;

/** Largest font (pt) at which these paragraphs fit the box, roughly (Calibri ~0.5em per char). */
function fitFont(paras: string[], w: number, h: number, start: number, min: number, gapPt = 6): number {
  for (let pt = start; pt > min; pt -= 1) {
    const perLine = Math.max(8, (w * 72) / (pt * 0.5));
    const lines = paras.reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
    if ((lines * pt * 1.2 + paras.length * gapPt) / 72 <= h) return pt;
  }
  return min;
}

function addPicture(sl: PptxGenJS.Slide, sp: SlidePicture, box: Box, th: (typeof THEMES)[keyof typeof THEMES], rtl: boolean) {
  const note = [sp.caption, sp.credit].filter(Boolean).join(" · ");
  const imgBox = note ? { ...box, h: box.h - 0.38 } : box;
  const f = fitContain(sp.pic.info.width, sp.pic.info.height, imgBox);
  sl.addImage({ data: `${sp.pic.info.mime};base64,${sp.pic.data.toString("base64")}`, x: f.x, y: f.y, w: f.w, h: f.h, altText: sp.caption || sp.credit || "Picture" });
  if (note) sl.addText(note, { x: box.x, y: f.y + f.h + 0.05, w: box.w, h: 0.3, fontSize: 10, color: th.muted, fontFace: FONT, align: "center", rtlMode: rtl && isRtlText(note) });
}

async function toPptx(title: string, subtitle: string, themeName: string, slides: SlideIn[], ws?: Workspace, coverRef?: unknown): Promise<{ data: Buffer; charts: number; pictures: number; notes: string[] }> {
  const th = THEMES[(themeName in THEMES ? themeName : "light") as keyof typeof THEMES];
  const list = slides.slice(0, 80);
  const notes: string[] = [];

  // Charts are checked first: a bad chart is the caller's to fix.
  const charts = list.map((s, i) => {
    if (!s.chart) return undefined;
    const c = normalizeChart(s.chart);
    if (typeof c === "string") throw new Error(`Slide ${i + 1} (${String(s.title ?? "").slice(0, 40)}) chart: ${c}`);
    return c;
  });
  // Pictures (local files or free photos) load in parallel; missing ones become notes.
  let budget = MAX_SLIDE_PICTURES;
  const want = (ref: unknown) => (ref && budget-- > 0 ? ref : undefined);
  const coverWanted = want(coverRef);
  const wanted = list.map((s) => want(s.image));
  if (list.some((s) => s.image) && budget < 0) notes.push(`Only the first ${MAX_SLIDE_PICTURES} pictures were added.`);
  const [cover, ...pics] = await Promise.all([slidePicture(coverWanted, ws, "any"), ...wanted.map((ref, i) => slidePicture(ref, ws, hasText(list[i]!) || charts[i] ? "any" : "wide"))]);
  for (const p of [cover, ...pics]) if (p?.note) notes.push(p.note);

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "oovi";
  pptx.title = title;

  // Title slide: accent band, big title, optional picture filling one side.
  const cs = pptx.addSlide();
  cs.background = { color: th.bg };
  const coverRtl = isRtlText(title + subtitle);
  const align = (rtl: boolean) => (rtl ? "right" : "left") as "right" | "left";
  const cp = cover?.picture;
  const picW = SW * 0.44;
  if (cp) {
    const px = coverRtl ? 0 : SW - picW;
    cs.addImage({ data: `${cp.pic.info.mime};base64,${cp.pic.data.toString("base64")}`, x: px, y: 0, w: picW, h: (picW * cp.pic.info.height) / cp.pic.info.width, sizing: { type: "cover", w: picW, h: SH }, altText: cp.caption || "Cover picture" });
    if (cp.credit || cp.caption) cs.addText([cp.caption, cp.credit].filter(Boolean).join(" · "), { x: px + 0.15, y: SH - 0.4, w: picW - 0.3, h: 0.3, fontSize: 9, color: "FFFFFF", fontFace: FONT, align: "right", shadow: { type: "outer", color: "000000", blur: 3, offset: 1, angle: 45, opacity: 0.6 } });
  }
  cs.addShape("rect", { x: coverRtl ? SW - 0.3 : 0, y: 0, w: 0.3, h: SH, fill: { color: th.accent }, line: { color: th.accent, width: 0 } });
  const textW = (cp ? SW - picW : SW) - 1.6;
  const tx = coverRtl ? (cp ? picW + 0.6 : 0.8) : 0.9;
  cs.addText(title, { x: tx, y: 1.5, w: textW, h: 2.4, fontSize: title.length > 70 ? 32 : title.length > 40 ? 38 : 44, bold: true, color: th.title, fontFace: FONT, valign: "bottom", align: align(coverRtl), rtlMode: coverRtl, fit: "shrink" });
  cs.addShape("rect", { x: coverRtl ? tx + textW - 1.3 : tx, y: 4.1, w: 1.3, h: 0.09, fill: { color: th.accent }, line: { color: th.accent, width: 0 } });
  if (subtitle) cs.addText(subtitle, { x: tx, y: 4.35, w: textW, h: 1.4, fontSize: 20, color: th.text, fontFace: FONT, valign: "top", align: align(coverRtl), rtlMode: coverRtl });

  let chartCount = 0;
  let picCount = cp ? 1 : 0;
  for (const [i, s] of list.entries()) {
    const sl = pptx.addSlide();
    const stitle = String(s.title ?? "").slice(0, 200);
    const bullets = Array.isArray(s.bullets) ? s.bullets.map((b) => String(b).slice(0, 500)).slice(0, 12) : [];
    const text = typeof s.text === "string" ? s.text.trim().slice(0, 2000) : "";
    const rtl = isRtlText(stitle + bullets.join(" ") + text);
    const al = align(rtl);
    if (typeof s.notes === "string" && s.notes.trim()) sl.addNotes(s.notes.slice(0, 5000));

    if (s.layout === "section") {
      const on = onColor(`#${th.accent}`).slice(1);
      sl.background = { color: th.accent };
      sl.addText(stitle, { x: 0.9, y: 1.9, w: SW - 1.8, h: 2.1, fontSize: 40, bold: true, color: on, fontFace: FONT, valign: "bottom", align: al, rtlMode: rtl, fit: "shrink" });
      sl.addShape("rect", { x: rtl ? SW - 0.9 - 1.2 : 0.9, y: 4.2, w: 1.2, h: 0.08, fill: { color: on }, line: { color: on, width: 0 } });
      if (text || bullets.length) sl.addText(text || bullets.join(" · "), { x: 0.9, y: 4.45, w: SW - 1.8, h: 1.6, fontSize: 20, color: on, fontFace: FONT, valign: "top", align: al, rtlMode: rtl });
      continue;
    }

    sl.background = { color: th.bg };
    sl.slideNumber = { x: rtl ? MARGIN : SW - MARGIN - 0.6, y: SH - 0.45, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: th.muted, align: rtl ? "left" : "right" };
    sl.addText(stitle, { x: MARGIN, y: 0.35, w: SW - 2 * MARGIN, h: 0.9, fontSize: stitle.length > 60 ? 24 : 30, bold: true, color: th.title, fontFace: FONT, align: al, rtlMode: rtl, valign: "middle" });
    sl.addShape("rect", { x: rtl ? SW - MARGIN - 0.9 : MARGIN, y: 1.22, w: 0.9, h: 0.06, fill: { color: th.accent }, line: { color: th.accent, width: 0 } });

    const chart = charts[i];
    const pic = pics[i]?.picture;
    const visuals = [chart, pic].filter(Boolean).length;
    const tb = s.table && Array.isArray(s.table.columns) && Array.isArray(s.table.rows) ? s.table : undefined;
    const withText = bullets.length > 0 || !!text || !!tb;
    const top = 1.55;
    const bottom = SH - 0.6;
    const full: Box = { x: MARGIN, y: top, w: SW - 2 * MARGIN, h: bottom - top };
    const gap = 0.45;
    let textBox = full;
    let visBox: Box | undefined;
    if (visuals && withText) {
      const tw = (full.w - gap) * 0.52;
      const vw = full.w - gap - tw;
      textBox = { ...full, x: rtl ? MARGIN + vw + gap : MARGIN, w: tw };
      visBox = { ...full, x: rtl ? MARGIN : MARGIN + tw + gap, w: vw };
    } else if (visuals) visBox = full;

    if (withText) {
      let y = textBox.y;
      const avail = textBox.h - (tb ? Math.min(2.6, 0.4 * (Math.min((tb.rows as unknown[]).length, 15) + 1)) + 0.2 : 0);
      if (bullets.length) {
        const share = text ? avail * 0.7 : avail;
        const pt = fitFont(bullets, textBox.w - 0.4, share, visBox ? 18 : 20, 12);
        const h = Math.min(share, bullets.reduce((n, b) => n + Math.max(1, Math.ceil(b.length / ((textBox.w - 0.4) * 144 / pt))), 0) * pt * 1.2 / 72 + bullets.length * 8 / 72 + 0.2);
        sl.addText(
          bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true, ...(rtl ? { rtlMode: true, align: "right" as const } : {}) } })),
          { x: textBox.x, y, w: textBox.w, h, fontSize: pt, color: th.text, fontFace: FONT, valign: "top", paraSpaceAfter: 6, align: al, rtlMode: rtl },
        );
        y += h + 0.1;
      }
      if (text) {
        const h = Math.max(0.6, avail - (y - textBox.y));
        const pt = fitFont([text], textBox.w, h, visBox ? 16 : 18, 11);
        sl.addText(text, { x: textBox.x, y, w: textBox.w, h, fontSize: pt, color: th.text, fontFace: FONT, valign: "top", align: al, rtlMode: rtl });
        y += Math.min(h, fitFontHeight(text, textBox.w, pt)) + 0.15;
      }
      if (tb) {
        const head = (tb.columns as unknown[]).map((c) => ({ text: String(c), options: { bold: true, fill: { color: th.accent }, color: onColor(`#${th.accent}`).slice(1) } }));
        const rows = (tb.rows as unknown[]).slice(0, 15).map((r) => asCells(r).map((c) => ({ text: c === null ? "" : String(c) })));
        sl.addTable([head, ...rows], { x: textBox.x, y: Math.min(y, bottom - 1), w: textBox.w, fontSize: visBox ? 12 : 14, color: th.text, fontFace: FONT, border: { type: "solid", pt: 0.5, color: th.grid }, autoPage: false, align: al });
      }
    }

    if (visBox) {
      const boxes: Box[] = visuals === 2 ? (withText ? [{ ...visBox, h: visBox.h * 0.55 - 0.1 }, { ...visBox, y: visBox.y + visBox.h * 0.55 + 0.1, h: visBox.h * 0.45 - 0.1 }] : [{ ...visBox, w: (visBox.w - gap) / 2, x: rtl ? visBox.x + (visBox.w + gap) / 2 : visBox.x }, { ...visBox, w: (visBox.w - gap) / 2, x: rtl ? visBox.x : visBox.x + (visBox.w + gap) / 2 }]) : [visBox];
      let k = 0;
      if (chart) {
        const pc = pptxChart(chart, { text: th.text, muted: th.muted, grid: th.grid, font: FONT });
        const b = boxes[k++]!;
        sl.addChart(pc.type, pc.data, { ...(pc.opts as PptxGenJS.IChartOpts), x: b.x, y: b.y, w: b.w, h: b.h, altText: chart.title || stitle });
        chartCount++;
      }
      if (pic) {
        addPicture(sl, pic, boxes[k++]!, th, rtl);
        picCount++;
      }
    }
  }
  return { data: (await pptx.write({ outputType: "nodebuffer" })) as Buffer, charts: chartCount, pictures: picCount, notes };
}

const hasText = (s: SlideIn) => (Array.isArray(s.bullets) && s.bullets.length > 0) || (typeof s.text === "string" && !!s.text.trim()) || !!s.table;
const fitFontHeight = (t: string, w: number, pt: number) => (Math.max(1, Math.ceil(t.length / ((w * 144) / pt))) * pt * 1.2) / 72;

// ---------- designed images ----------

async function createImage(call: ToolCall, ws: Workspace | undefined, browser: BrowserConfig): Promise<ToolResult> {
  const i = call.input;
  const { abs, shown } = outputPath(String(i.filename ?? ""), ws, ".png");
  const ext = path.extname(abs).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(ext)) return { id: call.id, name: call.name, content: `create_image makes .png or .jpg files, not ${ext}.`, isError: true };
  const pre = normalizeCard(i, false);
  if (typeof pre === "string") return { id: call.id, name: call.name, content: pre, isError: true };
  let chart: ChartData | undefined;
  if (i.chart) {
    const c = normalizeChart(i.chart);
    if (typeof c === "string") return { id: call.id, name: call.name, content: `chart: ${c}`, isError: true };
    chart = c;
  }

  // The photo: the user's own file (must work), an AI photo (their key), or a free photo; the last two fail soft.
  const notes: string[] = [];
  const photo = (i.photo && typeof i.photo === "object" ? i.photo : typeof i.photo === "string" ? { search: i.photo } : {}) as Record<string, unknown>;
  const shape = orientationFor(pre.width, pre.height);
  let picture: Picture | undefined;
  let printedCredit: string | undefined;
  if (typeof photo.path === "string" && photo.path.trim()) {
    picture = loadLocalPicture(photo.path, ws);
  } else {
    if (typeof photo.ai_prompt === "string" && photo.ai_prompt.trim()) {
      if (!aiPhotoProvider()) notes.push("No AI photo: that needs an OpenAI or Google Gemini API key in Settings.");
      else {
        try {
          picture = await aiPhoto(photo.ai_prompt, shape);
          notes.push(`The photo was generated with the user's own ${picture.source?.includes("Gemini") ? "Gemini" : "OpenAI"} key.`);
        } catch (e) {
          notes.push(`No AI photo (${(e as Error).message.slice(0, 200)}).`);
        }
      }
    }
    if (!picture && typeof photo.search === "string" && photo.search.trim()) {
      const found = await findPhoto(photo.search, shape, { allowWebp: true });
      if (found.picture) {
        picture = found.picture;
        printedCredit = found.picture.credit;
        notes.push(`${found.picture.credit} — ${found.picture.source}. The credit is printed small on the image; keep it when posting.`);
      } else notes.push(`No free photo was added for "${photo.search.slice(0, 60)}" (${found.error ?? "not found"}), so the design uses colors only.`);
    }
  }
  const spec = picture ? normalizeCard(i, true) : pre;
  if (typeof spec === "string") return { id: call.id, name: call.name, content: spec, isError: true };
  // A chart on a card takes the card's accent color unless colors were given.
  if (chart && !(i.chart as { colors?: unknown }).colors) chart = { ...chart, colors: [spec.colors.accent.slice(1), ...chart.colors.filter((c) => c !== spec.colors.accent.slice(1))] };
  const html = cardHtml(spec, { photo: picture ? { dataUri: pictureDataUri(picture), credit: printedCredit } : undefined, chart });
  const png = await renderHtml(html, spec.width, spec.height, browser, ext === ".png" ? "png" : "jpeg");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, png);
  const res = done(call, abs, shown, `an image (${spec.width}×${spec.height} ${ext === ".png" ? "PNG" : "JPEG"}${spec.dir === "rtl" ? ", right-to-left" : ""})`);
  return notes.length ? { ...res, content: `${res.content}\n${notes.join("\n")}` } : res;
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
        const found = resolveInDownloads(p);
        if (!found) return fail(`There's no file called ${path.basename(p.replace(/\\/g, "/"))} in Downloads/oovi (without a project folder, bots read files only from there). Check the name, or ask the user to attach the file.`);
        abs = found;
      }
      if (!fs.existsSync(abs)) return fail(`${p} doesn't exist.`);
      const text = await readDocument(abs);
      return { id: call.id, name: call.name, content: `${path.basename(abs)}:\n${text || "(no text)"}` };
    }

    const filename = String(i.filename ?? "");
    if (call.name === "create_document") {
      const part = String(i.content ?? "");
      if (!part.trim()) return fail("content is required");
      const base = path.basename(filename.trim().replace(/\\/g, "/"));
      // ".gitignore", ".env" and "Dockerfile" have no document extension: they'd become "…docx" files.
      const codeName = /^\.[^.]+$/.test(base) || /^(dockerfile|makefile|procfile|gemfile|rakefile|vagrantfile|jenkinsfile)$/i.test(base);
      const asked = codeName ? base : path.extname(cleanName(filename, ".docx")).toLowerCase();
      if (codeName || !DOC_EXTS.includes(asked)) {
        return fail(
          `create_document makes .docx, .pdf, .md, .html or .txt documents, not ${asked || "files without an extension"}. ` +
            (ws
              ? "Code and configuration files go in the project folder: use write_file."
              : "Code and configuration files go in the user's project folder: ask for it with use_project_folder (the folder they named), then use write_file. Don't save them, or a README instead, anywhere else meanwhile."),
        );
      }
      const append = i.append === true;
      let prev: DocSource | null = null;
      let target: { abs: string; shown: string };
      if (append) {
        const found = existingOutput(filename, ws);
        prev = found ? readDocSource(found.abs) : null;
        if (!found || !prev) return fail(`There's no document called ${path.basename(filename.replace(/\\/g, "/"))} made in parts here to add to${found ? " (it wasn't made by create_document, so its text can't be extended)" : ""}. Create it first without append, with the same filename.`);
        target = found;
      } else target = outputPath(filename, ws, ".docx");
      const content = prev ? `${prev.md.replace(/\s+$/, "")}\n\n${part}` : part;
      if (content.length > MAX_TEXT) return fail("That's too long for one document. Make the rest a second document (Part 2).");
      const title = prev ? prev.title : typeof i.title === "string" ? i.title.slice(0, 200) : undefined;
      const { abs, shown } = target;
      const ext = path.extname(abs).toLowerCase();
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (ext === ".docx") fs.writeFileSync(abs, await toDocx(content, title));
      else if (ext === ".pdf") fs.writeFileSync(abs, await toPdf(toHtml(content, title), browser));
      else if (ext === ".html" || ext === ".htm") fs.writeFileSync(abs, toHtml(content, title));
      else fs.writeFileSync(abs, title && ext === ".md" ? `# ${title}\n\n${content}` : content);
      writeDocSource(abs, { title, md: content });
      const res = done(call, abs, shown, ext === ".docx" ? "a Word document" : ext === ".pdf" ? "a PDF" : "a document");
      const sections = (content.match(/^#{1,3} /gm) ?? []).length;
      const words = content.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      return { ...res, content: `${prev ? `Added to ${shown}: it now has` : `${res.content} It has`} ${words} words${sections ? ` in ${sections} headed sections` : ""}. To add more sections, call create_document again with this filename and append: true.${prev ? " The user can open it from the chat." : ""}` };
    }

    if (call.name === "create_spreadsheet") {
      const sheets = Array.isArray(i.sheets) ? (i.sheets as SheetIn[]) : [];
      if (!sheets.length) return fail("Give at least one sheet with columns and rows.");
      const { abs, shown } = outputPath(filename, ws, ".xlsx");
      const ext = path.extname(abs).toLowerCase();
      if (ext !== ".xlsx" && ext !== ".csv") return fail(`create_spreadsheet makes .xlsx or .csv files, not ${ext}.`);
      if (ext === ".csv") {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, toCsv(sheets[0]!));
        const res = done(call, abs, shown, "a CSV file");
        return sheets.some((s) => Array.isArray(s.charts) && s.charts.length) ? { ...res, content: `${res.content}\nCSV files can't hold charts: make an .xlsx for charts.` } : res;
      }
      const book = await toXlsx(sheets);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, book.data);
      return done(call, abs, shown, book.charts ? `an Excel workbook with ${book.charts} native chart${book.charts > 1 ? "s" : ""}` : "an Excel workbook");
    }

    if (call.name === "create_presentation") {
      const slides = Array.isArray(i.slides) ? (i.slides as SlideIn[]) : [];
      if (!slides.length) return fail("Give at least one slide.");
      const { abs, shown } = outputPath(filename, ws, ".pptx");
      if (path.extname(abs).toLowerCase() !== ".pptx") return fail("create_presentation makes .pptx files.");
      const deck = await toPptx(String(i.title ?? "Presentation").slice(0, 200), String(i.subtitle ?? "").slice(0, 300), String(i.theme ?? "light"), slides, ws, i.cover_image);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, deck.data);
      const extras = [deck.charts && `${deck.charts} chart${deck.charts > 1 ? "s" : ""}`, deck.pictures && `${deck.pictures} picture${deck.pictures > 1 ? "s" : ""}`].filter(Boolean).join(", ");
      const res = done(call, abs, shown, `a PowerPoint presentation (${slides.slice(0, 80).length + 1} slides${extras ? `, ${extras}` : ""})`);
      return deck.notes.length ? { ...res, content: `${res.content}\n${deck.notes.join("\n")}` } : res;
    }

    if (call.name === "create_image") return await createImage(call, ws, browser);
    return fail(`Unknown tool: ${call.name}`);
  } catch (e) {
    return fail((e as Error).message || String(e));
  }
}

/** What the approval card shows when a bot creates a file inside a project folder. */
export function describeDocCall(call: ToolCall, ws: Workspace | undefined, tr: Tr = translateFor): { summary: string; detail?: string } {
  const name = String(call.input.filename ?? "file");
  const where = ws ? path.basename(ws.path) : saveFolderLabel();
  if (call.name === "create_document") return { summary: tr("ok.docCreate", { name, where }), detail: String(call.input.content ?? "").slice(0, 4000) };
  if (call.name === "create_spreadsheet") return { summary: tr("ok.sheetCreate", { name, where }) };
  if (call.name === "create_image") return { summary: tr("ok.imageCreate", { name, where }), detail: String(call.input.headline ?? "").slice(0, 400) };
  return { summary: tr("ok.slidesCreate", { name, where }) };
}
