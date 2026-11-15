// The "What's new" page (/changelog). Every version is shown the same way: an optional one-line headline, then
// up to four sections in a fixed order, each a list of short points.
//
// Where the words come from, first match wins:
//   1. what the owner saved in Admin > Release notes (app_config key "release_notes")
//   2. the polished text shipped with the site (release-notes-seed.ts), written for the versions released so far
//   3. the release's own notes on GitHub, if they follow the template below
//   4. the release's own notes on GitHub as written, with the install boilerplate removed
//
// Template for the notes of a NEW release (so they need no editing):
//   ### New        - **Short title.** One sentence about what you can do now.
//   ### Improved   - **Short title.** One sentence about what is better.
//   ### Fixed      - What was wrong, in the user's words.
//   ### Good to know   (optional) - Limits, privacy, anything that avoids a surprise.
// Nothing about the code, nobody's feedback, no install instructions (the page has one box for those).

export const SECTION_TITLES = ["New", "Improved", "Fixed", "Good to know"] as const;
export type SectionTitle = (typeof SECTION_TITLES)[number];
/** Form field name of each section in the admin editor. */
export const SECTION_FIELD: Record<SectionTitle, string> = { New: "new", Improved: "improved", Fixed: "fixed", "Good to know": "know" };
export type Section = { title: SectionTitle; items: string[] };
export type Notes = { headline?: string; sections: Section[]; hidden?: boolean };
export type NotesMap = Record<string, Notes>;

export const MAX_HEADLINE = 100;
export const MAX_ITEMS = 20;
export const MAX_ITEM = 600;

export const isVersion = (v: unknown): v is string => typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
export const versionOfTag = (tag: string) => tag.replace(/^v/, "");

/** Newest first. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Whatever was stored or typed, turned into safe notes: known sections only, one-line points, sensible lengths. */
export function normalizeNotes(input: unknown): Notes {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const sections: Section[] = [];
  const given = Array.isArray(r.sections) ? r.sections : [];
  for (const title of SECTION_TITLES) {
    const found = given.find((s) => s && typeof s === "object" && (s as { title?: unknown }).title === title) as { items?: unknown } | undefined;
    const items = (Array.isArray(found?.items) ? (found!.items as unknown[]) : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => clean(x, MAX_ITEM))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    if (items.length) sections.push({ title, items });
  }
  const headline = typeof r.headline === "string" ? clean(r.headline, MAX_HEADLINE) : "";
  return { ...(headline ? { headline } : {}), sections, ...(r.hidden === true ? { hidden: true } : {}) };
}

/** What the admin form sends: one point per line, "- " in front is allowed. */
export function itemsFromText(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s+/, ""))
    .map((l) => clean(l, MAX_ITEM + 1))
    .filter(Boolean);
}

/** Problems with what the admin typed, in plain words (empty = fine). */
export function checkText(headline: string, texts: Record<SectionTitle, string>): string[] {
  const errors: string[] = [];
  if (headline.trim().length > MAX_HEADLINE) errors.push(`The headline is too long (max ${MAX_HEADLINE} characters).`);
  let total = 0;
  for (const title of SECTION_TITLES) {
    const items = itemsFromText(texts[title]);
    total += items.length;
    if (items.length > MAX_ITEMS) errors.push(`“${title}” has more than ${MAX_ITEMS} points. Keep the main ones.`);
    if (items.some((i) => i.length > MAX_ITEM)) errors.push(`A point in “${title}” is longer than ${MAX_ITEM} characters. Cut it or split it.`);
    if (items.some((i) => /github\.com/i.test(i))) errors.push(`A point in “${title}” links to the code host. Nothing on the site points there.`);
  }
  if (total === 0) errors.push("Write at least one point, or hide this version instead.");
  return errors;
}

// ---------- GitHub's own notes ----------

const BOILERPLATE_HEADING = /^(updating|download|installing|install|how to update)\b/i;

/** The notes as written on the release, without the title line, the install steps and anything that points to the code host. */
export function stripBoilerplate(body: string): string {
  const out: string[] = [];
  let skipLevel = 0; // inside an install section: skip until a heading of the same or a higher level
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    if (/github/i.test(raw)) continue;
    const h = raw.trim().match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel && BOILERPLATE_HEADING.test(h[2]!.trim())) {
        skipLevel = level;
        continue;
      }
      if (!skipLevel && /^what.s new in oovi/i.test(h[2]!.trim())) continue;
    } else if (!skipLevel && /^what.s new in oovi\b/i.test(raw.trim())) continue;
    if (!skipLevel) out.push(raw);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The template above, read into notes. Returns null when the release was written another way. */
export function parseTemplate(body: string): Notes | null {
  const lines = stripBoilerplate(body).split("\n");
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      const title = SECTION_TITLES.find((t) => t.toLowerCase() === h[1]!.trim().toLowerCase());
      if (!title) return null; // a heading that is not one of ours: show the release as written
      cur = { title, items: [] };
      sections.push(cur);
      continue;
    }
    const li = l.match(/^[-*•]\s+(.*)$/);
    if (!cur || !li) return null;
    cur.items.push(li[1]!);
  }
  const notes = normalizeNotes({ sections });
  return notes.sections.length ? notes : null;
}

export type Resolved =
  | { kind: "hidden" }
  | { kind: "notes"; notes: Notes; source: "edited" | "default" | "github" }
  | { kind: "legacy"; markdown: string; source: "github" };

/** What to show for one version (see the order at the top of this file). */
export function resolveNotes(version: string, githubBody: string | null | undefined, overrides: NotesMap, seed: NotesMap): Resolved {
  const mine = overrides[version] ?? null;
  if (mine) return mine.hidden ? { kind: "hidden" } : { kind: "notes", notes: mine, source: "edited" };
  const shipped = seed[version] ?? null;
  if (shipped) return shipped.hidden ? { kind: "hidden" } : { kind: "notes", notes: shipped, source: "default" };
  const parsed = parseTemplate(githubBody ?? "");
  if (parsed) return { kind: "notes", notes: parsed, source: "github" };
  return { kind: "legacy", markdown: stripBoilerplate(githubBody ?? ""), source: "github" };
}
