// A small Markdown reader for bot replies on the phone: paragraphs, headings, lists, quotes, code, tables,
// links, bold, italic, strike and inline code. It never produces HTML: the screen draws the tree with React,
// so text is always text. Links keep only http(s), mailto and tel addresses. Pure: tested in
// tests/unit/mobile-markdown.test.mts.

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "s"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "ul" | "ol"; start?: number; items: Inline[][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; lang: string; v: string }
  | { t: "table"; head: Inline[][]; rows: Inline[][][]; align: ("l" | "c" | "r" | null)[] }
  | { t: "hr" };

/** Only addresses that are safe to open from a tap. */
export function safeHref(raw: string): string | null {
  const u = raw.trim().replace(/^<|>$/g, "");
  if (/^(https?:\/\/|mailto:|tel:)/i.test(u) && !/[\s"'<>]/.test(u)) return u;
  if (/^www\.[^\s]+\.[a-z]{2,}/i.test(u)) return `https://${u}`;
  return null;
}

const URL_RE = /\b(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»”’)\]])/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|~>]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "code", v: m[2]!.trim() });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[((?:[^\[\]]|\[[^\]]*\])+)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (m) {
        const href = safeHref(m[2]!);
        flush();
        if (href) out.push({ t: "a", href, c: parseInline(m[1]!) });
        else out.push(...parseInline(m[1]!));
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const dbl = src[i + 1] === ch;
      if (ch === "~" && !dbl) {
        buf += ch;
        i++;
        continue;
      }
      const mark = dbl ? ch + ch : ch;
      // An underscore inside a word (snake_case) is not emphasis.
      const prev = src[i - 1] ?? " ";
      const wordInside = ch === "_" && /[\p{L}\p{N}]/u.test(prev);
      const after = src[i + mark.length] ?? "";
      if (!wordInside && after && !/\s/.test(after)) {
        let j = i + mark.length;
        let end = -1;
        while (j < src.length) {
          const k = src.indexOf(mark, j);
          if (k < 0) break;
          const before = src[k - 1] ?? "";
          const next = src[k + mark.length] ?? "";
          const okEnd = !/\s/.test(before) && !(ch === "_" && /[\p{L}\p{N}]/u.test(next)) && (dbl || src[k + 1] !== ch);
          if (okEnd && k > i + mark.length - 1) {
            end = k;
            break;
          }
          j = k + mark.length;
        }
        if (end > i + mark.length - 1 && end !== i + mark.length) {
          flush();
          const inner = parseInline(src.slice(i + mark.length, end));
          out.push(ch === "~" ? { t: "s", c: inner } : dbl ? { t: "b", c: inner } : { t: "i", c: inner });
          i = end + mark.length;
          continue;
        }
      }
    }
    if (ch === "h" || ch === "w") {
      const m = ch === "h" ? URL_RE.exec(rest) : /^www\.[^\s<>()]+\.[a-z]{2,}[^\s<>()]*[^\s<>().,;:!?'"]/i.exec(rest);
      if (m && m.index === 0 && !/[\p{L}\p{N}]/u.test(src[i - 1] ?? " ")) {
        const href = safeHref(m[0]);
        if (href) {
          flush();
          out.push({ t: "a", href, c: [{ t: "text", v: m[0] }] });
          i += m[0].length;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
};
const isDelimRow = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");

export function parseMarkdown(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n").trim()) });
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      endPara();
      const close = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!);
      i++;
      blocks.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      endPara();
      i++;
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      endPara();
      blocks.push({ t: "h", level: h[1]!.length, c: parseInline(h[2]!) });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endPara();
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isDelimRow(lines[i + 1]!)) {
      endPara();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map((d) => (d.startsWith(":") && d.endsWith(":") ? "c" : d.endsWith(":") ? "r" : d.startsWith(":") ? "l" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
        i++;
      }
      blocks.push({ t: "table", head: head.map((c) => parseInline(c)), rows, align: head.map((_, k) => align[k] ?? null) });
      continue;
    }
    if (/^\s{0,3}>/.test(line) && depth < 4) {
      endPara();
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(body.join("\n"), depth + 1) });
      continue;
    }
    const li = /^(\s{0,3})([-*+]|(\d{1,9})[.)])\s+(.*)$/.exec(line);
    if (li) {
      endPara();
      const ordered = !!li[3];
      const items: string[][] = [];
      while (i < lines.length) {
        const m = /^(\s{0,3})([-*+]|(\d{1,9})[.)])\s+(.*)$/.exec(lines[i]!);
        if (m && !!m[3] === ordered) {
          items.push([m[4]!]);
          i++;
        } else if (items.length && lines[i]!.trim() && /^\s+/.test(lines[i]!)) {
          // A continuation line, or a nested item: kept as text of the current item.
          items[items.length - 1]!.push(lines[i]!.trim().replace(/^([-*+])\s+/, "• "));
          i++;
        } else break;
      }
      blocks.push({ t: ordered ? "ol" : "ul", ...(ordered && Number(li[3]) !== 1 ? { start: Number(li[3]) } : {}), items: items.map((it) => parseInline(it.join("\n"))) });
      continue;
    }
    para.push(line);
    i++;
  }
  endPara();
  return blocks;
}
