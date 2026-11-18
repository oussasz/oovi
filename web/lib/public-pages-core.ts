// Pages shared by a public link (a Canvas page: notes or a table). The app sends plain text or rows; the HTML is
// built here, every character escaped, so a shared page can never carry a script, a form or a hidden frame.
// Pure: tests/unit/public-pages.test.mts.

export const MAX_TITLE = 120;
export const MAX_TEXT = 300_000;
export const MAX_ROWS = 5000;
export const MAX_COLS = 40;
export const MAX_CELL = 2000;
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export type PageContent = { kind: "notes"; text: string } | { kind: "table"; columns: string[]; rows: string[][] };
export type PageInput = { title: string; content: PageContent };

const s = (v: unknown, max: number) => String(v ?? "").replace(/\u0000/g, "").slice(0, max);

/** A clean page from what the app sent, or why it can't be shared. */
export function validatePage(input: unknown): PageInput | string {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const title = s(o.title, MAX_TITLE).replace(/\s+/g, " ").trim();
  if (!title) return "Give the page a title.";
  const c = (o.content && typeof o.content === "object" ? o.content : {}) as Record<string, unknown>;
  if (c.kind === "notes") {
    const text = String(c.text ?? "");
    if (!text.trim()) return "The page is empty.";
    if (text.length > MAX_TEXT) return "The page is too long to share.";
    return { title, content: { kind: "notes", text: s(text, MAX_TEXT) } };
  }
  if (c.kind === "table") {
    if (!Array.isArray(c.columns) || !Array.isArray(c.rows)) return "The table is missing.";
    if (c.columns.length > MAX_COLS || c.rows.length > MAX_ROWS) return `The table is too big to share (at most ${MAX_ROWS} rows and ${MAX_COLS} columns).`;
    const columns = c.columns.map((x) => s(x, 200));
    const rows = c.rows.map((r) => (Array.isArray(r) ? r.slice(0, columns.length).map((x) => s(x, MAX_CELL)) : []));
    if (!columns.length) return "The table has no columns.";
    return { title, content: { kind: "table", columns, rows } };
  }
  return "Only notes and tables can be shared.";
}

export const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A link only when it is a plain http(s) address; it opens apart and passes nothing on. */
function link(url: string, label: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return esc(label);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return esc(label);
  return `<a href="${esc(u.href)}" rel="nofollow noopener noreferrer ugc" target="_blank">${esc(label)}</a>`;
}

/** Bold, italics, `code` and links inside one line (already a plain string: escaped here). */
export function inline(line: string): string {
  const out: string[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+|\*[^*\s][^*\n]*\*)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    const t = m[0];
    out.push(esc(line.slice(last, m.index)));
    if (t.startsWith("`")) out.push(`<code>${esc(t.slice(1, -1))}</code>`);
    else if (t.startsWith("**")) out.push(`<strong>${esc(t.slice(2, -2))}</strong>`);
    else if (t.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\((.+)\)$/.exec(t)!;
      out.push(link(mm[2]!, mm[1]!));
    } else if (t.startsWith("http")) {
      const trail = /[.,;:!?]+$/.exec(t)?.[0] ?? "";
      const u = trail ? t.slice(0, -trail.length) : t;
      out.push(link(u, u.replace(/^https?:\/\/(www\.)?/, "")) + esc(trail));
    } else out.push(`<em>${esc(t.slice(1, -1))}</em>`);
    last = (m.index ?? 0) + t.length;
  }
  out.push(esc(line.slice(last)));
  return out.join("");
}

/** Notes (simple Markdown: headings, lists, quotes, code blocks, paragraphs) as safe HTML. */
export function notesHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p dir="auto">${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l)) {
      flush();
      close();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(l);
    const ul = /^\s*[-*•]\s+(.+)$/.exec(l);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(l);
    const q = /^>\s?(.*)$/.exec(l);
    if (h) {
      flush();
      close();
      const n = Math.min(4, h[1]!.length + 1);
      out.push(`<h${n} dir="auto">${inline(h[2]!)}</h${n}>`);
    } else if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li dir="auto">${inline((ul ?? ol)![1]!)}</li>`);
    } else if (q) {
      flush();
      close();
      out.push(`<blockquote dir="auto">${inline(q[1]!)}</blockquote>`);
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) {
      flush();
      close();
      out.push("<hr>");
    } else if (!l.trim()) {
      flush();
      close();
    } else {
      close();
      para.push(l);
    }
  }
  flush();
  close();
  return out.join("\n");
}

/** A table as safe HTML (links in cells become links). */
export function tableHtml(columns: string[], rows: string[][]): string {
  const head = `<thead><tr>${columns.map((c) => `<th dir="auto">${esc(c)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((r) => `<tr>${columns.map((_, i) => `<td dir="auto">${inline(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

export const pageHtml = (c: PageContent) => (c.kind === "notes" ? notesHtml(c.text) : tableHtml(c.columns, c.rows));
