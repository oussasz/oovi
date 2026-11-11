// Phone numbers, emails and addresses of a web page.
// Pure (only linkedom), so it can be unit-tested: tests/unit/contacts.test.mts.
import { parseHTML } from "linkedom";

// Phone numbers, emails and addresses usually sit in buttons, side panels, footers, "tel:" links or
// the page's structured data: exactly what a "main text" reader throws away. They're collected from the
// whole page and added to what the bot reads, so a directory listing doesn't look like it has no number.

const digitsOf = (x: string) => x.replace(/\D/g, "");
const PHONE_LABEL = "(?:t[ée]l(?:[ée]phone)?|phone|mobile|portable|gsm|fax|whats ?app|viber|call|appel(?:ez)?|contact|هاتف|الهاتف|جوال|موبايل|اتصل|واتساب)";
const LABELLED = new RegExp(`${PHONE_LABEL}\\s*\\.?\\s*[:：]?\\s*((?:\\+|00)?\\d[\\d\\s().\\-/]{6,22}\\d)`, "giu");
const INTERNATIONAL = /(?:^|[^\w+])((?:\+|00)\d[\d\s().-]{7,20}\d)/g;
const validPhone = (x: string) => {
  const d = digitsOf(x);
  return d.length >= 8 && d.length <= 15 && !/^(\d)\1+$/.test(d);
};

function jsonLdContacts(node: unknown, out: string[], depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const x of node.slice(0, 50)) jsonLdContacts(x, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  for (const k of ["telephone", "faxNumber"]) for (const v of Array.isArray(o[k]) ? (o[k] as unknown[]) : [o[k]]) if (str(v)) out.push(`${k === "faxNumber" ? "Fax" : "Phone"}: ${str(v)}`);
  if (str(o.email)) out.push(`Email: ${str(o.email).replace(/^mailto:/i, "")}`);
  const ad = o.address;
  if (typeof ad === "string" && ad.trim()) out.push(`Address: ${ad.trim()}`);
  else if (ad && typeof ad === "object" && !Array.isArray(ad)) {
    const A = ad as Record<string, unknown>;
    const line = [A.streetAddress, A.addressLocality, A.addressRegion, A.postalCode, typeof A.addressCountry === "object" && A.addressCountry ? (A.addressCountry as Record<string, unknown>).name : A.addressCountry].map(str).filter(Boolean).join(", ");
    if (line) out.push(`Address: ${line}`);
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") jsonLdContacts(v, out, depth + 1);
}

/** Phones, emails, WhatsApp links and addresses found anywhere on the page (deduplicated, at most 25). */
export function contactDetails(html: string): string[] {
  const { document } = parseHTML(html);
  if (!document.documentElement) return []; // an empty answer
  const out: string[] = [];
  const decode = (x: string) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  for (const a of Array.from(document.querySelectorAll("a[href]")).slice(0, 3000)) {
    const href = (a.getAttribute("href") ?? "").trim();
    if (/^tel:/i.test(href)) out.push(`Phone: ${decode(href.slice(4)).trim()}`);
    else if (/^mailto:/i.test(href)) out.push(`Email: ${decode(href.slice(7)).split("?")[0]!.trim()}`);
    else if (/^https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send)/i.test(href)) {
      const n = href.match(/(?:wa\.me\/|phone=)\+?(\d{8,15})/i)?.[1];
      if (n) out.push(`WhatsApp: +${n}`);
    }
  }
  for (const el of Array.from(document.querySelectorAll('[itemprop="telephone"], [itemprop="faxNumber"], [itemprop="email"]')).slice(0, 50)) {
    const v = (el.getAttribute("content") || el.textContent || "").trim();
    const kind = el.getAttribute("itemprop");
    if (v) out.push(`${kind === "email" ? "Email" : kind === "faxNumber" ? "Fax" : "Phone"}: ${v.replace(/\s+/g, " ")}`);
  }
  for (const sc of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20)) {
    try {
      jsonLdContacts(JSON.parse(sc.textContent ?? ""), out);
    } catch {
      /* not valid JSON: skip */
    }
  }
  // Numbers written in the page text, including the parts a reader skips (buttons, side panels, footers).
  for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg"))) el.remove();
  const text = (document.body?.textContent ?? "").replace(/\s+/g, " ").slice(0, 400_000);
  for (const m of text.matchAll(LABELLED)) if (m[1]) out.push(`Phone: ${m[1].trim()}`);
  for (const m of text.matchAll(INTERNATIONAL)) if (m[1]) out.push(`Phone: ${m[1].trim()}`);

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of out) {
    const [kind, ...rest] = line.split(": ");
    const value = rest.join(": ").trim().slice(0, 200);
    const phoneLike = kind === "Phone" || kind === "Fax" || kind === "WhatsApp";
    if (!value || (phoneLike && !validPhone(value))) continue;
    // The same number written two ways ("0555 12 34 56", "+213555123456") is listed once.
    const key = phoneLike ? `n:${digitsOf(value).replace(/^00/, "").slice(-9)}` : `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(`${kind}: ${value}`);
    if (kept.length >= 25) break;
  }
  return kept;
}

