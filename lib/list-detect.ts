// Does a page hold a list of many items (a directory, search results, a catalogue)? Read from the
// page's HTML without a browser, so read_url and research can tell the bot "this page is a list of
// 40 items: scrape_list takes them all", at the moment it reads one. Bots kept reading such pages
// piece by piece instead of collecting them. Same idea as LIST_JS (lib/page-list.ts), without layout.
// Uses linkedom only: tests/unit/list-detect.test.mts.

import { parseHTML } from "linkedom";

export type ListInfo = { items: number; phones: number; next: boolean; sample: string[] };

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "BR", "HR", "SVG", "HEAD"]);
const PHONE = /(?:\+|00)\d[\d\s().-]{7,18}\d|(?<!\d)0[1-9](?:[\s.-]?\d){7,9}(?!\d)/;
const NEXT = /^(next|suivant|suivante|page suivante|siguiente|weiter|nächste|التالي|›|»|>|→)$/i;

const sig = (el: Element) => `${el.tagName}|${(el.getAttribute("class") ?? "").trim().split(/\s+/).filter((c) => c && !/\d{3,}/.test(c)).slice(0, 3).sort().join(".")}`;
const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The page's main list, when it has at least `min` items that each hold some text. */
export function listInfo(html: string, min = 8): ListInfo | null {
  if (!html || html.length < 200) return null;
  const { document } = parseHTML(html);
  if (!document.documentElement) return null;
  let best: { score: number; group: Element[] } | null = null;
  const all = Array.from(document.querySelectorAll("body *")).slice(0, 20_000);
  for (const parent of all) {
    if (parent.children.length < min || SKIP.has(parent.tagName)) continue;
    if (parent.closest("nav, footer, header, [role=navigation], [role=menu], select")) continue;
    const groups = new Map<string, Element[]>();
    for (const ch of Array.from(parent.children)) {
      if (SKIP.has(ch.tagName)) continue;
      const k = sig(ch);
      groups.set(k, [...(groups.get(k) ?? []), ch]);
    }
    for (const g of groups.values()) {
      if (g.length < min) continue;
      const lens = g.map((e) => textOf(e).length);
      const filled = lens.filter((n) => n >= 12).length;
      if (filled < min || filled < g.length * 0.6) continue;
      const avg = lens.reduce((a, n) => a + n, 0) / g.length;
      if (avg > 2500) continue; // a few long blocks are the page's sections, not a list
      const score = lens.reduce((a, n) => a + Math.min(n, 300), 0) * Math.log2(g.length);
      if (!best || score > best.score) best = { score, group: g };
    }
  }
  if (!best) return null;
  const items = best.group;
  const phones = items.filter((e) => PHONE.test(textOf(e)) || !!e.querySelector('a[href^="tel:"]')).length;
  const next =
    !!document.querySelector('a[rel~="next"]') ||
    Array.from(document.querySelectorAll("a[href], button")).some((a) => NEXT.test(textOf(a).replace(/^[\s←‹«<]+|[\s→›»>]+$/g, "")) || NEXT.test((a.getAttribute("aria-label") ?? "").trim()));
  return { items: items.length, phones, next, sample: items.slice(0, 3).map((e) => textOf(e).slice(0, 60)) };
}

/** What the bot is told under a page that is a list. */
export function listHint(info: ListInfo | null | undefined, url: string): string {
  if (!info) return "";
  return `--- This page is a list of about ${info.items} items${info.phones ? ` (${info.phones} show a phone number)` : ""}${info.next ? ", and it has more pages" : ""}. To keep them all, call scrape_list with url="${url}" and a table name${info.next ? " and pages (it goes through the next pages by itself)" : ""}, and details=true when each item's own page has the details you need. One call does what reading it piece by piece would take dozens of steps to do. ---`;
}
