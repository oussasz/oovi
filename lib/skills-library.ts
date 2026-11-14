// The skills library: hundreds of skills from open-source collections (built by
// scripts/import-skills.mjs from repositories whose license allows it; notices in THIRD_PARTY_SKILLS.md).
// Server-side only: the text is several megabytes, so the Marketplace pages through it by API.

import data from "./skills-library.json";
import type { CatalogSkill } from "./catalog";

export type LibrarySkill = CatalogSkill & { source: { repo: string; path: string; license: string; url: string; copyright: string } };
export type LibraryCard = Omit<LibrarySkill, "body">;

const ALL = data as LibrarySkill[];
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Search by words in the name and description (every word must match), optionally in one category. */
export function searchLibrary(q: string, category: string | null, offset = 0, limit = 30): { total: number; items: LibraryCard[] } {
  const words = norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hits = ALL.filter((s) => (!category || s.category === category) && words.every((w) => norm(`${s.name} ${s.description}`).includes(w)))
    // Name matches first.
    .sort((a, b) => Number(words.length > 0 && words.every((w) => norm(b.name).includes(w))) - Number(words.length > 0 && words.every((w) => norm(a.name).includes(w))));
  return { total: hits.length, items: hits.slice(offset, offset + limit).map(({ body: _b, ...card }) => card) };
}

export const librarySkill = (id: string): LibrarySkill | undefined => ALL.find((s) => s.id === id);
export const librarySize = () => ALL.length;
