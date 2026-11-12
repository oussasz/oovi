// A list pulled from a web page (extract_list in tools.ts): what each item becomes, and how the
// items go into a work table. Pure (no imports: the caller finds the contact details with
// contacts.ts and passes them in), so it is unit-tested: tests/unit/page-list.test.mts.

/** One repeated item of the page, as the page script returns it. */
export type RawItem = { text: string[]; links: string[]; html: string };
export type ListRow = { name: string; details: string; phone: string; email: string; link: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const hostOf = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The item's text, one cleaned line each, without repeats. */
export const itemLines = (item: RawItem): string[] => {
  const lines: string[] = [];
  for (const l of item.text.map(clean)) if (l && !lines.includes(l)) lines.push(l);
  return lines;
};

/**
 * One item as a row: its name (first line), the rest of its text, and its contact details.
 * found: contactDetails() of the item's HTML. bare: phonesInText() of its lines.
 */
export function rowOf(item: RawItem, pageUrl: string, found: string[], bare: string[]): ListRow | null {
  const lines = itemLines(item);
  const name = (lines[0] ?? "").slice(0, 160);
  if (!name) return null;
  const phones = found.filter((c) => /^(Phone|WhatsApp): /.test(c)).map((c) => c.replace(/^\w+: /, ""));
  for (const p of bare) if (!phones.some((x) => x.replace(/\D/g, "").slice(-8) === p.replace(/\D/g, "").slice(-8))) phones.push(p);
  const email = found.find((c) => c.startsWith("Email: "))?.slice(7) ?? "";
  const page = hostOf(pageUrl);
  const web = item.links.filter((l) => /^https?:/i.test(l));
  // The business's own site when the item links to one; else the item's page on this site.
  const link = web.find((l) => hostOf(l) && hostOf(l) !== page) ?? web[0] ?? "";
  return { name, details: lines.slice(1).join(" · ").slice(0, 400), phone: phones.slice(0, 3).join(" / "), email, link };
}

const COLS: { field: keyof ListRow | "source"; title: string; like: RegExp }[] = [
  { field: "details", title: "Details", like: /detail|note|info|descr|adress|address|catégor|categor|type|تفاصيل|عنوان/i },
  { field: "phone", title: "Phone", like: /phone|t[ée]l|mobile|portable|gsm|whats ?app|num[ée]ro|number|هاتف|جوال|رقم/i },
  { field: "email", title: "Email", like: /e-?mail|courriel|بريد/i },
  { field: "link", title: "Link", like: /site|web|url|link|lien|page|موقع|رابط/i },
  { field: "source", title: "Source", like: /source|origine|found|trouv|مصدر/i },
];

/**
 * The rows as objects keyed by the table's own column names, so they land in the right columns of
 * a table the team already has (the name goes in its first column). A field with no matching column
 * gets a column of its own, and only when at least one row has a value for it.
 */
export function rowsForTable(columns: string[] | undefined, rows: ListRow[], source: string): Record<string, string>[] {
  const first = columns?.[0] || "Name";
  const taken = new Set<string>([first]);
  const key = new Map<string, string>();
  for (const c of COLS) {
    const has = c.field === "source" ? !!source : rows.some((r) => r[c.field as keyof ListRow]);
    if (!has) continue;
    const match = columns?.find((col) => !taken.has(col) && c.like.test(col));
    const k = match ?? c.title;
    taken.add(k);
    key.set(c.field, k);
  }
  return rows.map((r) => {
    const o: Record<string, string> = { [first]: r.name };
    for (const [field, k] of key) {
      const v = field === "source" ? source : r[field as keyof ListRow];
      if (v) o[k] = v;
    }
    return o;
  });
}

/** One item on one line, for the bot to read. */
export const rowLine = (r: ListRow, n: number) => `${n}. ${[r.name, r.details, r.phone && `Phone: ${r.phone}`, r.email && `Email: ${r.email}`, r.link].filter(Boolean).join(" | ")}`;
