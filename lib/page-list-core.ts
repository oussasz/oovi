// A list pulled from a web page (extract_list in tools.ts): what each item becomes, and how the
// items go into a work table. Pure (no imports: the caller finds the contact details with
// contacts.ts and passes them in), so it is unit-tested: tests/unit/page-list.test.mts.

/** One repeated item of the page, as the page script returns it. */
export type RawItem = { text: string[]; links: string[]; html: string; fields?: Record<string, string> };
/**
 * link: the business's own site when the item links to one, else the item's page.
 * page: the item's own page on the site being read (where its details are). address: from the item's page.
 * extra: columns the caller asked for by selector (scrape_list `fields`). source: the page the item was found on,
 * when the rows come from several pages.
 */
export type ListRow = { name: string; details: string; phone: string; email: string; link: string; page?: string; address?: string; extra?: Record<string, string>; source?: string };

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
  const own = web.find((l) => hostOf(l) === page && l.split("#")[0] !== pageUrl.split("#")[0]);
  const extra = item.fields && Object.keys(item.fields).length ? item.fields : undefined;
  return { name, details: lines.slice(1).join(" · ").slice(0, 400), phone: phones.slice(0, 3).join(" / "), email, link, ...(own ? { page: own } : {}), ...(extra ? { extra } : {}) };
}

type Field = "details" | "phone" | "email" | "link" | "address";
const COLS: { field: Field | "source"; title: string; like: RegExp }[] = [
  { field: "details", title: "Details", like: /detail|note|info|descr|catégor|categor|type|تفاصيل/i },
  { field: "address", title: "Address", like: /adress|address|عنوان/i },
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
    const has = c.field === "source" ? !!source || rows.some((r) => r.source) : rows.some((r) => r[c.field as Field]);
    if (!has) continue;
    const match = columns?.find((col) => !taken.has(col) && c.like.test(col));
    const k = match ?? c.title;
    taken.add(k);
    key.set(c.field, k);
  }
  return rows.map((r) => {
    const o: Record<string, string> = { [first]: r.name };
    for (const [field, k] of key) {
      const v = field === "source" ? r.source || source : r[field as Field];
      if (v) o[k] = v;
    }
    // Columns asked for by name: written as asked (a column the table already has under that name is reused).
    for (const [col, v] of Object.entries(r.extra ?? {})) if (v && col !== first) o[col] = v;
    return o;
  });
}

/** One item on one line, for the bot to read. */
export const rowLine = (r: ListRow, n: number) => `${n}. ${[r.name, r.details, r.address, r.phone && `Phone: ${r.phone}`, r.email && `Email: ${r.email}`, r.link].filter(Boolean).join(" | ")}`;

const digits = (p: string) => p.replace(/\D/g, "").replace(/^00/, "").slice(-9);

/**
 * Phone numbers and emails that are the website's own, not an item's: the same value on most of the
 * item pages read from one site (a directory's contact number in every footer). pages: the contact
 * lines found on each page. Needs at least 4 pages to judge.
 */
export function siteWide(pages: string[][]): Set<string> {
  const out = new Set<string>();
  if (pages.length < 4) return out;
  const count = new Map<string, number>();
  for (const lines of pages) for (const k of new Set(lines.map(contactKey).filter(Boolean))) count.set(k, (count.get(k) ?? 0) + 1);
  for (const [k, n] of count) if (n > pages.length / 2) out.add(k);
  return out;
}

/** "Phone: 0550 12 34 56" and "WhatsApp: +213550123456" are the same contact; emails compare without case. */
export function contactKey(line: string): string {
  const [kind, ...rest] = line.split(": ");
  const v = rest.join(": ").trim();
  if (!v) return "";
  if (kind === "Phone" || kind === "WhatsApp" || kind === "Fax") return digits(v).length >= 8 ? `p:${digits(v)}` : "";
  if (kind === "Email") return `e:${v.toLowerCase()}`;
  return "";
}

/** What an item's own page adds to its row: only what the row doesn't have yet, never the site's own contacts. */
export function withDetails(row: ListRow, found: string[], skip: Set<string>): ListRow {
  const mine = found.filter((l) => !skip.has(contactKey(l)));
  const phones = mine.filter((l) => /^(Phone|WhatsApp): /.test(l)).map((l) => l.replace(/^\w+: /, ""));
  const unique = phones.filter((p, i) => phones.findIndex((x) => digits(x) === digits(p)) === i);
  return {
    ...row,
    phone: row.phone || unique.slice(0, 3).join(" / "),
    email: row.email || (mine.find((l) => l.startsWith("Email: "))?.slice(7) ?? ""),
    ...(row.address ? {} : ((a) => (a ? { address: a } : {}))(mine.find((l) => l.startsWith("Address: "))?.slice(9) ?? "")),
  };
}
