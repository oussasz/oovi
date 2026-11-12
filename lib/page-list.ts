// Lists on a web page, in the bots' browser: the scripts that run inside the page (scroll, find the
// list, find the "next page" control) and the helpers extract_list and scrape_list share.
// What an item becomes is in page-list-core.ts (pure, unit-tested).

import type { Page } from "playwright-core";
import { contactDetails, phonesInText } from "./contacts";
import { itemLines, rowOf, type ListRow, type RawItem } from "./page-list-core";

// Runs inside the page. Scrolls the window and every scrollable panel (a results list often scrolls
// inside its own box, not with the page). Returns whether anything moved.
export const SCROLL_JS = `((to) => {
  const boxes = [document.scrollingElement || document.documentElement];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (el.clientHeight < 150 || el.scrollHeight - el.clientHeight < 100) continue;
    const o = getComputedStyle(el).overflowY;
    if (o === "auto" || o === "scroll") boxes.push(el);
  }
  let moved = false;
  for (const el of boxes) {
    const before = el.scrollTop;
    const page = Math.max(200, (el === boxes[0] ? window.innerHeight : el.clientHeight) * 0.9);
    el.scrollTop = to === "top" ? 0 : to === "bottom" ? el.scrollHeight : to === "up" ? before - page : before + page;
    if (Math.abs(el.scrollTop - before) > 2) moved = true;
  }
  return moved;
})`;

// Runs inside the page. Finds the page's main list: the largest group of sibling elements built the
// same way (same tag and classes) that each hold some text. Returns each item's text lines, links and HTML.
export const LIST_JS = `((arg) => {
  const hint = (arg.containing || "").toLowerCase();
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const sig = (el) => el.tagName + "|" + (typeof el.className === "string" ? el.className.trim().split(/\\s+/).filter((c) => c && !/\\d{3,}/.test(c)).slice(0, 3).sort().join(".") : "");
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, OPTION: 1, BR: 1, HR: 1 };
  // An item's text, one line per visual piece. innerText alone glues pieces a site sets side by side
  // with spacing but no space character ("Salon Lina" + "Kouba" -> "Salon LinaKouba"): a new line
  // starts at every block, table cell and line break, and between two inline pieces that touch.
  const blockOf = (node) => {
    let e = node.parentElement;
    while (e && /^inline/.test(getComputedStyle(e).display) && getComputedStyle(e).display !== "inline-block") e = e.parentElement;
    return e;
  };
  const linesOf = (root) => {
    const lines = [];
    let cur = "";
    let lastBlock = null;
    let lastParent = null;
    const flush = () => { const t = cur.replace(/\\s+/g, " ").trim(); if (t) lines.push(t); cur = ""; };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 1) {
        if (n.tagName === "BR") flush();
        continue;
      }
      const p = n.parentElement;
      if (!p || SKIP[p.tagName] || !n.nodeValue || !n.nodeValue.trim()) { if (n.nodeValue && cur) cur += " "; continue; }
      const st = getComputedStyle(p);
      if (st.display === "none" || st.visibility === "hidden") continue;
      const block = blockOf(n);
      const touching = cur && !/\\s$/.test(cur) && !/^\\s/.test(n.nodeValue) && p !== lastParent;
      if (block !== lastBlock || touching) flush();
      cur += n.nodeValue;
      lastBlock = block;
      lastParent = p;
    }
    flush();
    return lines;
  };
  let items = null;
  if (arg.selector) {
    try { items = Array.from(document.querySelectorAll(arg.selector)); } catch (e) { return { error: "bad selector" }; }
  } else {
    let best = null;
    for (const parent of Array.from(document.querySelectorAll("body, body *"))) {
      if (parent.children.length < 3 || SKIP[parent.tagName]) continue;
      const groups = new Map();
      for (const ch of Array.from(parent.children)) {
        if (SKIP[ch.tagName]) continue;
        const k = sig(ch);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(ch);
      }
      for (const g of groups.values()) {
        if (g.length < 3) continue;
        const lens = g.map((e) => (e.textContent || "").replace(/\\s+/g, " ").trim().length);
        const filled = lens.filter((n) => n >= 12).length;
        if (filled < 3 || filled < g.length * 0.6) continue;
        let score = lens.reduce((s, n) => s + Math.min(n, 300), 0) * Math.log2(g.length);
        // A few very long blocks are the page's sections, not a list.
        if (lens.reduce((s, n) => s + n, 0) / g.length > 2500) score *= 0.2;
        if (parent.closest("nav, footer, header, [role=navigation], [role=menu], select")) score *= 0.1;
        if (hint && g.some((e) => (e.textContent || "").toLowerCase().includes(hint))) score *= 4;
        if (!best || score > best.score) best = { score, g };
      }
    }
    items = best ? best.g : [];
  }
  const out = [];
  for (const el of items) {
    if (out.length >= 400) break;
    if (!shown(el)) continue;
    const text = linesOf(el).slice(0, 25);
    if (!text.length) continue;
    const links = [];
    const as = el.matches("a[href]") ? [el] : Array.from(el.querySelectorAll("a[href]"));
    for (const a of as.slice(0, 20)) if (a.href && !links.includes(a.href)) links.push(a.href);
    const fields = {};
    for (const [col, how] of Object.entries(arg.fields || {})) {
      // "selector" gives the element's text; "selector@attr" one of its attributes (href, src, title…).
      const at = String(how).lastIndexOf("@");
      const css = at > 0 ? String(how).slice(0, at) : String(how);
      const attr = at > 0 ? String(how).slice(at + 1) : "";
      let hit = null;
      try { hit = css.trim() ? el.querySelector(css) : el; } catch (e) { return { error: "bad field selector: " + css }; }
      if (!hit) continue;
      const v = attr ? (attr === "href" && hit.href ? hit.href : attr === "src" && hit.src ? hit.src : hit.getAttribute(attr)) : hit.innerText || hit.textContent;
      if (v) fields[col] = String(v).replace(/\\s+/g, " ").trim().slice(0, 1000);
    }
    out.push({ text, links: links.slice(0, 8), html: el.outerHTML.slice(0, 15000), fields });
  }
  return { items: out };
})`;

// Runs inside the page. Finds the control that leads to the next page of results and marks it with
// data-oc-next. Returns { href } for a plain link, { click: true } for a button, or {} when there is none.
export const NEXT_JS = `((sel) => {
  document.querySelectorAll("[data-oc-next]").forEach((e) => e.removeAttribute("data-oc-next"));
  const usable = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && !el.disabled && el.getAttribute("aria-disabled") !== "true" && !/\\bdisabled\\b/.test(typeof el.className === "string" ? el.className : "");
  };
  const WORDS = /^(next|next page|suivant|suivante|page suivante|siguiente|weiter|nächste|sonraki|التالي|الصفحة التالية|›|»|>|→|>>)$/i;
  let el = null;
  if (sel) { try { el = document.querySelector(sel); } catch (e) { return { error: "bad selector" }; } }
  if (!usable(el)) el = Array.from(document.querySelectorAll('a[rel~="next"]')).find(usable) || null;
  if (!el) {
    const all = Array.from(document.querySelectorAll("a[href], button, [role=button], [role=link]"));
    // "Next →", "Suivant »": the word with or without its arrow.
    const says = (t) => { const x = (t || "").replace(/\\s+/g, " ").trim(); return !!x && (WORDS.test(x) || WORDS.test(x.replace(/^[\\s←‹«<]+|[\\s→›»>]+$/g, ""))); };
    el = all.find((e) => usable(e) && (says(e.getAttribute("aria-label")) || says(e.getAttribute("title")) || says(e.innerText))) || null;
  }
  if (!el) {
    // Numbered pages: the link that follows the current page's number.
    const cur = Array.from(document.querySelectorAll('[aria-current="page"], .active, .current, .selected')).find((e) => /^\\d{1,4}$/.test((e.innerText || "").trim()));
    if (cur) {
      const want = String(Number(cur.innerText.trim()) + 1);
      const box = cur.closest("nav, ul, ol, [class*=pag], [role=navigation]") || cur.parentElement;
      el = box ? Array.from(box.querySelectorAll("a[href], button")).find((e) => usable(e) && (e.innerText || "").trim() === want) || null : null;
    }
  }
  if (!el) return {};
  el.setAttribute("data-oc-next", "1");
  const href = el.tagName === "A" && /^https?:/i.test(el.href || "") && !(el.getAttribute("href") || "").startsWith("#") ? el.href : "";
  return href ? { href } : { click: true };
})`;

export type ListArg = { containing: string; selector: string; fields?: Record<string, string> };

/**
 * The items of the page's list, loading more first when asked (scrolling to the end up to `more`
 * times). Items are collected across scrolls: some pages drop what leaves the screen.
 */
export async function collectList(page: Page, arg: ListArg, more: number, signal?: AbortSignal): Promise<{ items: RawItem[]; loads: number; error?: string }> {
  const seen = new Map<string, RawItem>();
  const collect = async (): Promise<string | null> => {
    const r = (await page.evaluate(`${LIST_JS}(${JSON.stringify(arg)})`)) as { items?: RawItem[]; error?: string };
    if (r.error) return r.error;
    for (const it of r.items ?? []) {
      const key = it.text.join("|");
      if (!seen.has(key)) seen.set(key, it);
    }
    return null;
  };
  const bad = await collect();
  if (bad) return { items: [], loads: 0, error: bad };
  let loads = 0;
  for (let quiet = 0; loads < more && quiet < 2 && !signal?.aborted; loads++) {
    const size = seen.size;
    await page.evaluate(`${SCROLL_JS}("bottom")`);
    await page.waitForTimeout(1_200);
    await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
    await collect();
    quiet = seen.size > size ? 0 : quiet + 1;
  }
  return { items: [...seen.values()], loads };
}

/** Items as rows, with the contact details found in each. */
export function toRows(items: RawItem[], pageUrl: string): ListRow[] {
  const rows: ListRow[] = [];
  for (const it of items) {
    const row = rowOf(it, pageUrl, contactDetails(`<html><body>${it.html}</body></html>`), phonesInText(itemLines(it).join("\n")));
    if (row) rows.push(row);
  }
  return rows;
}
