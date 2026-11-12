// find_places (places.ts): the parts with no network, so they are unit-tested
// (tests/unit/places.test.mts). The data is Overture Maps "places": open data, one row per business.

/** A row for the work table (the same shape as ListRow in page-list-core.ts; no import, so the oovi
 * server can use an identical copy of this file: web/lib/places-core.ts, checked by tests/unit/places-sync.test.mts). */
export type PlaceRow = { name: string; details: string; phone: string; email: string; link: string; address?: string; extra?: Record<string, string>; source?: string };

export type Box = { xmin: number; xmax: number; ymin: number; ymax: number };

/** One row of the Overture places files (only the columns read). */
export type Place = {
  names?: { primary?: string | null } | null;
  basic_category?: string | null;
  taxonomy?: { primary?: string | null; hierarchy?: string[] | null; alternates?: string[] | null } | null;
  phones?: string[] | null;
  emails?: string[] | null;
  websites?: string[] | null;
  socials?: string[] | null;
  addresses?: { freeform?: string | null; locality?: string | null; postcode?: string | null; region?: string | null; country?: string | null }[] | null;
  confidence?: number | null;
  operating_status?: string | null;
  bbox?: Box | null;
};

export const overlaps = (a: Box, b: Box) => a.xmin <= b.xmax && a.xmax >= b.xmin && a.ymin <= b.ymax && a.ymax >= b.ymin;
export const inside = (p: Box | null | undefined, b: Box) => !!p && p.xmin >= b.xmin && p.xmin <= b.xmax && p.ymin >= b.ymin && p.ymin <= b.ymax;

/** Roughly how wide and tall an area is, in kilometres. */
export function sizeKm(b: Box): { w: number; h: number } {
  const lat = ((b.ymin + b.ymax) / 2) * (Math.PI / 180);
  return { w: Math.abs(b.xmax - b.xmin) * 111.32 * Math.cos(lat), h: Math.abs(b.ymax - b.ymin) * 110.57 };
}

/** A point, or an area smaller than a neighbourhood block, becomes about 3 km across: "near this address". */
export function atLeast(b: Box, km = 3): Box {
  const { w, h } = sizeKm(b);
  const lat = ((b.ymin + b.ymax) / 2) * (Math.PI / 180);
  const dx = w < km ? (km - w) / 2 / (111.32 * Math.cos(lat)) : 0;
  const dy = h < km ? (km - h) / 2 / 110.57 : 0;
  return { xmin: b.xmin - dx, xmax: b.xmax + dx, ymin: b.ymin - dy, ymax: b.ymax + dy };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** "cafes" and "café" both find "cafe"; "beauty salons" finds "beauty_salon". */
const stem = (w: string) => (w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
export const categoryWords = (wanted: unknown): string[] =>
  (Array.isArray(wanted) ? wanted : typeof wanted === "string" ? wanted.split(/[,;]/) : [])
    .map((w) => norm(String(w)).split(" ").map(stem).join(" "))
    .filter((w) => w.length >= 2)
    .slice(0, 12);

/** The place's categories, most specific first, as words ("beauty salon", "personal or beauty service"). */
export function categoriesOf(p: Place): string[] {
  const all = [p.taxonomy?.primary, ...(p.taxonomy?.alternates ?? []), ...(p.taxonomy?.hierarchy ?? []).slice().reverse(), p.basic_category];
  return [...new Set(all.filter((c): c is string => !!c).map(norm))];
}

/** Does the place belong to one of the wanted categories? Every word of a wanted category must be in one of the place's. */
export function inCategory(p: Place, words: string[]): boolean {
  if (!words.length) return true;
  const cats = categoriesOf(p).map((c) => ` ${c.split(" ").map(stem).join(" ")} `);
  return words.some((w) => cats.some((c) => w.split(" ").every((part) => c.includes(` ${part} `) || c.includes(` ${part}`))));
}

const CLOSED = /closed/i;
export const isOpen = (p: Place) => !p.operating_status || !CLOSED.test(p.operating_status);

/** The data holds a few placeholder links ("http://...."): only a link with a real host name is kept. */
const realUrl = (u: string) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(x.hostname);
  } catch {
    return false;
  }
};

/** A place as a row for the work table. */
export function placeRow(p: Place, source: string): PlaceRow | null {
  const name = (p.names?.primary ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const a = p.addresses?.[0];
  const address = [a?.freeform, a?.locality, a?.postcode].map((x) => (x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
  const site = (p.websites ?? []).find(realUrl) ?? "";
  const social = (p.socials ?? []).find(realUrl) ?? "";
  const cat = categoriesOf(p)[0] ?? "";
  return {
    name: name.slice(0, 160),
    details: cat,
    phone: (p.phones ?? []).filter(Boolean).slice(0, 3).join(" / "),
    email: (p.emails ?? []).find(Boolean) ?? "",
    link: site || social,
    ...(address ? { address } : {}),
    ...(site && social ? { extra: { Social: social } } : {}),
    source,
  };
}

/** The categories found in an area, most common first: shown when the wanted ones match nothing. */
export function topCategories(places: Place[], max = 40): string[] {
  const n = new Map<string, number>();
  for (const p of places) {
    const c = categoriesOf(p)[0];
    if (c) n.set(c, (n.get(c) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c, k]) => `${c.replace(/ /g, "_")} (${k})`);
}

/** Name filter: every word of `q` starts a word of the place's name (accents and case ignored): "lin" finds "Salon Lina", "9" doesn't find "39". */
export const nameHas = (p: Place, q: string) => {
  const n = ` ${norm(p.names?.primary ?? "")}`;
  return norm(q).split(" ").filter(Boolean).every((w) => n.includes(` ${w}`));
};

export type PlaceQuery = { words: string[]; name: string; withPhone: boolean; limit: number };
export type PlaceAnswer = { hits: Place[]; matching: number; open: number; top: string[] };

/** The places of an area that answer a question, best-known first. The app and the oovi server use the same rule. */
export function filterPlaces(places: Place[], q: PlaceQuery): PlaceAnswer {
  const open = places.filter(isOpen);
  let hits = open.filter((p) => inCategory(p, q.words) && (!q.name || nameHas(p, q.name)));
  if (q.withPhone) hits = hits.filter((p) => p.phones?.some(Boolean));
  hits.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return { hits: hits.slice(0, Math.min(2000, Math.max(1, q.limit))), matching: hits.length, open: open.length, top: hits.length ? [] : topCategories(open) };
}
