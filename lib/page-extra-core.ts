// Text a page shows that its own text doesn't hold: embedded frames (a booking or menu widget, a form from another
// site) and web components (shadow DOM). Bots read only the page's own text, so a café's menu in a widget or a
// clinic's opening hours in a web component never reached them. Pure: tests/unit/page-extra.test.mts.
import { isPrivateHost } from "./net-guard-core.ts";

/** What embedded parts may add to a page's text, in all. */
export const EMBED_MAX = 6000;
/** Frames read per page, at most. */
export const MAX_FRAMES = 6;

/** Ads, trackers and consent boxes: their frames hold nothing a bot needs. */
const NOISE = /doubleclick|googlesyndication|googletagmanager|google-analytics|facebook\.com\/tr|adservice|adnxs|criteo|taboola|outbrain|hotjar|consent|cookiebot|onetrust|recaptcha|hcaptcha/i;

/** Whether an embedded frame is worth reading (and allowed: never a private address unless the user allows it). */
export function frameAllowed(url: string, allowPrivate: boolean): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (NOISE.test(url)) return false;
  return allowPrivate || !isPrivateHost(u.hostname);
}

const host = (where: string) => {
  try {
    return new URL(where).hostname;
  } catch {
    return "";
  }
};
const key = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 120).toLowerCase();

/** The page's text, then the embedded parts it doesn't already hold, marked as embedded and bounded in all. */
export function mergeEmbedded(main: string, parts: { where: string; text: string }[]): string {
  const seen = main.replace(/\s+/g, " ").toLowerCase();
  let room = EMBED_MAX;
  const add: string[] = [];
  for (const p of parts) {
    const text = p.text.replace(/\n{3,}/g, "\n\n").trim();
    if (!text || room <= 0) continue;
    if (seen.includes(key(text))) continue;
    const piece = text.slice(0, room);
    const h = host(p.where);
    add.push(`--- Embedded in the page${h ? ` (${h})` : ""} ---\n${piece}`);
    room -= piece.length;
  }
  return add.length ? `${main}\n\n${add.join("\n\n")}` : main;
}

/**
 * Runs in the page: the text inside web components (open shadow roots), which document.body.innerText leaves out.
 * Returns one string per component that has text, at most 30.
 */
export const SHADOW_TEXT_JS = `(() => {
  const out = [];
  const walk = (root, depth) => {
    if (depth > 6 || out.length >= 30) return;
    for (const el of root.querySelectorAll("*")) {
      if (!el.shadowRoot) continue;
      const t = Array.from(el.shadowRoot.children).map((c) => (c.innerText || c.textContent || "")).join("\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
      if (t) out.push(t.slice(0, 4000));
      walk(el.shadowRoot, depth + 1);
      if (out.length >= 30) return;
    }
  };
  walk(document, 0);
  return out;
})()`;
