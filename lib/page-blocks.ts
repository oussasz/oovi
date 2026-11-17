// A Canvas page's Markdown split into blocks (headings, paragraphs, lists with tick-boxes, tables, quotes,
// code, rules) for components/PageView.tsx, which draws them without ever injecting HTML.
// Each list item remembers its line, so ticking a box rewrites exactly that line.
// Pure: tests/unit/page-blocks.test.mts.

export type ListItem = { text: string; line: number; done: boolean | null; depth: number };
export type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

const ITEM = /^(\s*)(?:[-*+•]|(\d{1,3})[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseBlocks(text: string): Block[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) body.push(lines[i]!);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: "h", level: Math.min(3, h[1]!.length) as 1 | 2 | 3, text: h[2]! });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ kind: "hr" });
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && isRow(lines[i]!); i++) rows.push(cells(lines[i]!));
      i--;
      out.push({ kind: "table", head, rows });
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const first = ITEM.exec(line)!;
      const ordered = first[2] !== undefined;
      const items: ListItem[] = [];
      for (; i < lines.length; i++) {
        const m = ITEM.exec(lines[i]!);
        if (!m) {
          // A wrapped line belongs to the item above it.
          if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) {
            items.at(-1)!.text += ` ${lines[i]!.trim()}`;
            continue;
          }
          break;
        }
        // Bullets followed by numbers (or the reverse) at the same level are two lists.
        if (items.length && !m[1] && (m[2] !== undefined) !== ordered) break;
        items.push({ text: m[4]!, line: i, done: m[3] === undefined ? null : m[3] !== " ", depth: Math.min(3, Math.floor(m[1]!.replace(/\t/g, "  ").length / 2)) });
      }
      i--;
      out.push({ kind: "list", ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^\s*>\s?/, ""));
      i--;
      out.push({ kind: "quote", text: q.join("\n") });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** The text with the tick-box on that line turned on or off (nothing changes when the line has no box). */
export function toggleBox(text: string, line: number): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const cur = lines[line];
  if (cur === undefined) return text;
  const next = cur.replace(/^(\s*(?:[-*+•]|\d{1,3}[.)])\s+)\[( |x|X)\]/, (_m, pre: string, box: string) => `${pre}[${box === " " ? "x" : " "}]`);
  if (next === cur) return text;
  lines[line] = next;
  return lines.join("\n");
}

/** How far a plan is: boxes ticked out of all boxes (null when the page has none). */
export function progress(text: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const b of parseBlocks(text)) if (b.kind === "list") for (const it of b.items) if (it.done !== null) (total++, it.done && done++);
  return total ? { done, total } : null;
}
