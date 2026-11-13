// find_papers (papers.ts): the parts with no network, so they are unit-tested
// (tests/unit/papers.test.mts): what each catalogue's answer becomes, how the same paper found in
// several catalogues is merged, and the row written to the work table.

export type Paper = {
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  type: string;
  doi: string;
  link: string;
  /** A link where the full text can be read without paying, when a catalogue gives one. */
  open: string;
  citations: number | null;
  abstract: string;
  sources: string[];
};

const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
export const cleanDoi = (d: unknown) => String(d ?? "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase();
const authorsLine = (names: string[]) => (names.length > 8 ? `${names.slice(0, 8).join(", ")}, et al. (${names.length} authors)` : names.join(", "));
const num = (v: unknown): number | null => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

type J = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});

/** Crossref /works items. */
export function fromCrossref(json: unknown): Paper[] {
  const out: Paper[] = [];
  for (const raw of arr(obj(obj(json).message).items)) {
    const it = obj(raw);
    const title = clean(arr(it.title)[0]);
    if (!title) continue;
    const doi = cleanDoi(it.DOI);
    const names = arr(it.author).map((a) => clean([obj(a).given, obj(a).family].filter(Boolean).join(" ") || obj(a).name)).filter(Boolean);
    // A full-text link the publisher marks as free to read for text mining is not proof of open access: only the DOI link is given.
    out.push({
      title,
      authors: authorsLine(names),
      year: num(arr(arr(obj(it.issued)["date-parts"])[0])[0]),
      venue: clean(arr(it["container-title"])[0]),
      type: clean(it.type).replace(/-/g, " "),
      doi,
      link: doi ? `https://doi.org/${doi}` : clean(it.URL),
      open: "",
      citations: num(it["is-referenced-by-count"]),
      abstract: clean(it.abstract).replace(/^abstract\s*/i, ""),
      sources: ["Crossref"],
    });
  }
  return out;
}

/** Europe PMC /search results (resultType=core). */
export function fromEuropePmc(json: unknown): Paper[] {
  const out: Paper[] = [];
  for (const raw of arr(obj(obj(json).resultList).result)) {
    const it = obj(raw);
    const title = clean(it.title).replace(/\.$/, "");
    if (!title) continue;
    const doi = cleanDoi(it.doi);
    const urls = arr(obj(it.fullTextUrlList).fullTextUrl).map(obj);
    const free = urls.find((u) => /^(OA|F)$/.test(String(u.availabilityCode)) && /pdf/i.test(String(u.documentStyle))) ?? urls.find((u) => /^(OA|F)$/.test(String(u.availabilityCode)));
    const id = clean(it.id);
    const src = clean(it.source);
    const names = clean(it.authorString).replace(/\.$/, "").split(/,\s*/).filter(Boolean);
    out.push({
      title,
      authors: authorsLine(names),
      year: num(it.pubYear),
      venue: clean(obj(obj(it.journalInfo).journal).title) || clean(obj(it.bookOrReportDetails).publisher),
      type: clean(arr(obj(it.pubTypeList).pubType)[0]).toLowerCase(),
      doi,
      link: doi ? `https://doi.org/${doi}` : id && src ? `https://europepmc.org/article/${src}/${id}` : "",
      open: free ? clean(free.url) : it.pmcid && String(it.isOpenAccess) === "Y" ? `https://europepmc.org/article/PMC/${clean(it.pmcid)}` : "",
      citations: num(it.citedByCount),
      abstract: clean(it.abstractText),
      sources: ["Europe PMC"],
    });
  }
  return out;
}

/** arXiv's Atom feed. Every arXiv paper is free to read. */
export function fromArxiv(xml: string): Paper[] {
  const out: Paper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const tag = (name: string) => clean(e.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
    const title = tag("title");
    if (!title) continue;
    const abs = tag("id").replace(/^http:/, "https:").replace(/v\d+$/, "");
    const doi = cleanDoi(tag("arxiv:doi"));
    const names = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((x) => clean(x[1])).filter(Boolean);
    out.push({
      title,
      authors: authorsLine(names),
      year: num(tag("published").slice(0, 4)),
      venue: clean(tag("arxiv:journal_ref")) || `arXiv ${e.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? ""}`.trim(),
      type: "preprint",
      doi,
      link: abs,
      open: abs.replace("/abs/", "/pdf/"),
      citations: null,
      abstract: tag("summary"),
      sources: ["arXiv"],
    });
  }
  return out;
}

const titleKey = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");

/** The same paper from several catalogues becomes one, keeping the fullest value of each field. */
export function mergePapers(lists: Paper[][]): Paper[] {
  const out: Paper[] = [];
  const byDoi = new Map<string, Paper>();
  const byTitle = new Map<string, Paper>();
  for (const p of lists.flat()) {
    const tk = titleKey(p.title);
    const old = (p.doi && byDoi.get(p.doi)) || (tk.length >= 25 ? byTitle.get(`${tk}|${p.year ?? ""}`) ?? (p.year === null ? undefined : byTitle.get(`${tk}|`)) : undefined);
    if (!old) {
      const copy = { ...p, sources: [...p.sources] };
      out.push(copy);
      if (p.doi) byDoi.set(p.doi, copy);
      if (tk.length >= 25) byTitle.set(`${tk}|${p.year ?? ""}`, copy);
      continue;
    }
    old.authors ||= p.authors;
    old.year ??= p.year;
    old.venue ||= p.venue;
    old.type ||= p.type;
    if (!old.doi && p.doi) {
      old.doi = p.doi;
      byDoi.set(p.doi, old);
    }
    old.link ||= p.link;
    old.open ||= p.open;
    old.citations = old.citations === null ? p.citations : p.citations === null ? old.citations : Math.max(old.citations, p.citations);
    if (p.abstract.length > old.abstract.length) old.abstract = p.abstract;
    for (const s of p.sources) if (!old.sources.includes(s)) old.sources.push(s);
  }
  return out;
}

// ---------- on topic ----------
// The catalogues match words loosely: "startup readiness" also brings reactor start-up and surgical
// readiness. A record whose title or abstract holds every word of one of the asked phrasings comes
// first; the others follow, and the bot is told how many there are.

const STOP = new Set(["the", "and", "for", "with", "from", "into", "onto", "over", "under", "about", "between", "among", "of", "in", "on", "to", "a", "an", "or", "by", "at", "as", "is", "are", "its", "their", "via", "vs", "versus", "using", "based", "study", "studies", "review", "effect", "effects", "role", "impact", "analysis"]);
/** Lower case, accents and hyphens away ("start-up" and "startup" are one word). */
const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/(\p{L})[-‐‑](?=\p{L})/gu, "$1");
/** The start of a word without its usual English ending, matched as a word start: "fouling" finds "fouled", "membranes" finds "membrane". */
const stem = (w: string) => {
  if (w.length <= 4) return w;
  const cut = w.replace(/(ations?|ings?|ness|ments?|ies|es|s|ed|al|ity)$/, "");
  return cut.length >= 3 ? cut : w;
};

/** The words that make a phrasing (no stop words, at least 2 letters, quotes and brackets ignored). */
export function topicWords(phrase: string): string[] {
  const words = plain(phrase).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words.map(stem).filter((w) => w.length >= 2))];
}

/** 2: every word of one phrasing is in the title or abstract; 1: at least one word; 0: none. */
export function topicMatch(p: Paper, phrasings: string[][]): 0 | 1 | 2 {
  const text = plain(`${p.title} ${p.abstract}`).replace(/[^\p{L}\p{N}]+/gu, " ");
  const has = (w: string) => new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
  let some = false;
  for (const words of phrasings) {
    if (!words.length) continue;
    const hits = words.filter(has).length;
    if (hits === words.length) return 2;
    if (hits) some = true;
  }
  return some ? 1 : 0;
}

/** Records holding a whole phrasing first, then the partial ones, then the rest; each group keeps its order. */
export function onTopicFirst(papers: Paper[], phrasings: string[][]): { papers: Paper[]; full: number } {
  const scored = papers.map((p, i) => ({ p, i, m: topicMatch(p, phrasings) }));
  scored.sort((a, b) => b.m - a.m || a.i - b.i);
  return { papers: scored.map((x) => x.p), full: scored.filter((x) => x.m === 2).length };
}

export type PaperFilter = { yearFrom?: number; yearTo?: number; openOnly?: boolean };
export const keepPaper = (p: Paper, f: PaperFilter) => (!f.yearFrom || (p.year !== null && p.year >= f.yearFrom)) && (!f.yearTo || (p.year !== null && p.year <= f.yearTo)) && (!f.openOnly || !!p.open);

/** Sorted for the reader: as found (the catalogues' own relevance, interleaved), newest first, or most cited first. */
export function sortPapers(lists: Paper[][], merged: Paper[], how: "relevance" | "newest" | "most_cited"): Paper[] {
  if (how === "newest") return [...merged].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (how === "most_cited") return [...merged].sort((a, b) => (b.citations ?? -1) - (a.citations ?? -1));
  // Relevance: the first of each catalogue, then the second of each… A paper several catalogues rank well comes early.
  const rank = new Map<Paper, number>();
  const find = (p: Paper) => merged.find((m) => (p.doi && m.doi === p.doi) || titleKey(m.title) === titleKey(p.title));
  for (const list of lists) list.forEach((p, i) => {
    const m = find(p);
    if (m) rank.set(m, Math.min(rank.get(m) ?? Infinity, i));
  });
  return [...merged].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}

/** A paper as a row of the work table. The abstract is the last column: long text stays out of the way. */
export function paperRow(p: Paper, withAbstract: boolean): Record<string, string> {
  return {
    Title: p.title,
    Authors: p.authors,
    Year: p.year === null ? "" : String(p.year),
    Journal: p.venue,
    Type: p.type,
    Citations: p.citations === null ? "" : String(p.citations),
    DOI: p.doi,
    Link: p.link,
    "Free full text": p.open,
    Source: p.sources.join(" + "),
    ...(withAbstract ? { Abstract: p.abstract.slice(0, 1900) } : {}),
  };
}

export const paperLine = (p: Paper, n: number) =>
  `${n}. ${p.title} (${[p.authors.split(", ").slice(0, 3).join(", ") + (p.authors.split(", ").length > 3 ? " et al." : ""), p.year ?? "n.d.", p.venue].filter(Boolean).join("; ")})${p.citations !== null ? ` · cited ${p.citations}` : ""}${p.open ? ` · free: ${p.open}` : ""} · ${p.link}`;
