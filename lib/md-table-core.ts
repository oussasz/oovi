// Markdown tables inside a chat message ("| a | b |" + "| --- | --- |" + rows), cut out of the text so the chat
// can draw them as real tables. Everything else stays text. Pure: tests/unit/md-table.test.mts.

export type MdSegment = { kind: "text"; text: string } | { kind: "table"; header: string[]; align: ("left" | "center" | "right" | null)[]; rows: string[][] };

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l) || (l.includes("|") && /\S\s*\|\s*\S/.test(l) && !/^\s*```/.test(l));
/** The line under the header: every cell is dashes with optional colons ("---", ":--", "-:", ":-:"). */
const isSep = (l: string) => /^[\s|:-]+$/.test(l) && l.includes("-") && cellsOf(l).every((c) => /^:?-+:?$/.test(c));

/** The cells of one table line ("| a | b |" → ["a", "b"]); an escaped \| stays in the cell. */
export function cellsOf(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|") && !l.endsWith("\\|")) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/g;
const LETTER = /\p{L}/gu;

/** Which way the columns run: right to left when most letters of the header are Arabic or Hebrew (the body rows
 *  decide when the header has no letters). Links are skipped so a URL in a cell doesn't count. */
export function tableDir(t: { header: string[]; rows: string[][] }): "rtl" | "ltr" {
  const count = (cells: string[]) => {
    const s = cells.join(" ").replace(/https?:\/\/\S+/g, "");
    return { rtl: (s.match(RTL_LETTER) ?? []).length, all: (s.match(LETTER) ?? []).length };
  };
  let c = count(t.header);
  if (!c.all) c = count(t.rows.flat());
  return c.all > 0 && c.rtl * 2 > c.all ? "rtl" : "ltr";
}

/** GitHub's left/right alignment, made to follow the table's direction (left = where a row starts). */
export const cellAlign = (a: "left" | "center" | "right" | null) => (a === "left" ? "start" : a === "right" ? "end" : a === "center" ? "center" : undefined);

export function splitTables(text: string): MdSegment[] {
  const lines = text.split("\n");
  const out: MdSegment[] = [];
  let buf: string[] = [];
  let fence = false;
  const flush = () => {
    if (buf.length) out.push({ kind: "text", text: buf.join("\n") });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*```/.test(l)) fence = !fence;
    const next = lines[i + 1];
    if (!fence && isRow(l) && next !== undefined && isSep(next) && cellsOf(l).length >= 2 && cellsOf(next).length === cellsOf(l).length) {
      const header = cellsOf(l);
      const align = cellsOf(next).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j]!) && lines[j]!.trim()) {
        const c = cellsOf(lines[j]!);
        rows.push(header.map((_, k) => c[k] ?? ""));
        j++;
      }
      // The blank line the text had before the table is dropped (the table has its own spacing).
      while (buf.length && !buf.at(-1)!.trim()) buf.pop();
      flush();
      out.push({ kind: "table", header, align, rows });
      i = j - 1;
      if (lines[i + 1] !== undefined && !lines[i + 1]!.trim()) i++;
      continue;
    }
    buf.push(l);
  }
  flush();
  return out.length ? out : [{ kind: "text", text }];
}
