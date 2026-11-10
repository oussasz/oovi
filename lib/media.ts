// Image helpers for slides and designed images: sniffing image bytes, fitting a picture in a
// box, and free-photo search (Openverse, then Wikimedia Commons; no API key) with credits.
//
// Pure: no imports with side effects (unit-tested straight from the .ts file). The network
// part lives in lib/render.ts.

export type ImageKind = "png" | "jpeg" | "gif" | "webp";
export type ImageInfo = { kind: ImageKind; width: number; height: number; mime: string };

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

/** Type and pixel size from the file's header, or null if it isn't a PNG, JPEG, GIF or WebP. */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { kind: "png", width: u32be(b, 16), height: u32be(b, 20), mime: "image/png" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1]!;
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { kind: "jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5), mime: "image/jpeg" };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { kind: "gif", width: u16le(b, 6), height: u16le(b, 8), mime: "image/gif" };
  }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (fourcc === "VP8X") return { kind: "webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, mime: "image/webp" };
    if (fourcc === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { kind: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: "image/webp" };
    }
    if (fourcc === "VP8 ") return { kind: "webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, mime: "image/webp" };
  }
  return null;
}

/**
 * A path a bot gave for a file in Downloads/oovi, made relative to that folder: bots repeat the
 * folder's name ("Downloads/oovi/Brief.docx", "oovi\Brief.docx"), which isn't part of the path.
 */
export function stripDownloadsPrefix(p: string): string {
  return String(p ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(\.[\\/])+/, "")
    .replace(/^(downloads[\\/]+)?oovi(?:[\\/]+|$)/i, "");
}

export const validImage = (i: ImageInfo | null): i is ImageInfo => !!i && i.width > 0 && i.height > 0 && i.width <= 20_000 && i.height <= 20_000;

/** Largest rectangle with the image's shape inside the box, centered. */
export function fitContain(imgW: number, imgH: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0) return { ...box };
  const s = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

// ---------- free photos ----------

export type PhotoCandidate = { url: string; width?: number; height?: number; title: string; creator: string; license: string; landing: string; source: "Openverse" | "Wikimedia Commons" };
export type Orientation = "square" | "tall" | "wide" | "any";

const clean = (s: unknown, max = 200) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function photoQuery(q: unknown): string {
  return clean(q, 120).replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
}

export function openverseUrl(query: string, orientation: Orientation = "any"): string {
  const p = new URLSearchParams({ q: query, page_size: "20", license_type: "commercial", mature: "false" });
  if (orientation === "square") p.set("aspect_ratio", "square");
  else if (orientation === "tall") p.set("aspect_ratio", "tall");
  else if (orientation === "wide") p.set("aspect_ratio", "wide");
  return `https://api.openverse.org/v1/images/?${p}`;
}

const LICENSE_OK = /^(cc0|pdm|by|by-sa)$/i;

/** Openverse results we may use in a business post (no NC/ND), biggest-enough first. */
export function parseOpenverse(json: unknown, minWidth = 800): PhotoCandidate[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: PhotoCandidate[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const url = typeof r.url === "string" ? r.url : "";
    const lic = String(r.license ?? "");
    const type = String(r.filetype ?? "").toLowerCase();
    if (!/^https:\/\//.test(url) || !LICENSE_OK.test(lic)) continue;
    if (type && !["jpg", "jpeg", "png"].includes(type)) continue;
    const width = Number(r.width) || undefined;
    if (width && width < minWidth) continue;
    const version = r.license_version ? ` ${String(r.license_version)}` : "";
    out.push({
      url,
      width,
      height: Number(r.height) || undefined,
      title: clean(r.title, 120),
      creator: clean(r.creator, 80) || "unknown",
      license: lic.toLowerCase() === "cc0" ? "CC0" : lic.toLowerCase() === "pdm" ? "Public domain" : `CC ${lic.toUpperCase()}${version}`,
      landing: typeof r.foreign_landing_url === "string" ? r.foreign_landing_url : url,
      source: "Openverse",
    });
  }
  return out;
}

export function commonsUrl(query: string, width = 1600): string {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(width),
    origin: "*",
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

export function parseCommons(json: unknown, minWidth = 800): PhotoCandidate[] {
  const pages = (json as { query?: { pages?: Record<string, unknown> } })?.query?.pages;
  if (!pages || typeof pages !== "object") return [];
  const list = Object.values(pages) as { index?: number; title?: string; imageinfo?: Record<string, unknown>[] }[];
  list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: PhotoCandidate[] = [];
  for (const p of list) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const mime = String(ii.mime ?? "");
    if (mime !== "image/jpeg" && mime !== "image/png") continue;
    const meta = (ii.extmetadata ?? {}) as Record<string, { value?: unknown }>;
    const lic = clean(meta.LicenseShortName?.value, 60);
    if (!lic || /\b(nc|nd)\b|non-?commercial|no ?deriv|fair use/i.test(lic)) continue;
    if (!/cc0|public domain|^cc[- ]by|^pd\b/i.test(lic)) continue;
    const width = Number(ii.width) || 0;
    if (width && width < minWidth) continue;
    const url = String(ii.thumburl ?? ii.url ?? "");
    if (!/^https:\/\//.test(url)) continue;
    out.push({
      url,
      width: Number(ii.thumbwidth ?? ii.width) || undefined,
      height: Number(ii.thumbheight ?? ii.height) || undefined,
      title: clean(p.title?.replace(/^File:/, "").replace(/\.\w+$/, ""), 120),
      creator: clean(meta.Artist?.value, 80) || "unknown",
      license: lic,
      landing: String(ii.descriptionurl ?? url),
      source: "Wikimedia Commons",
    });
  }
  return out;
}

/** "Photo: Jane Doe, CC BY 2.0 (Openverse)" — short enough to print on the image. */
export function creditLine(c: Pick<PhotoCandidate, "creator" | "license" | "source">): string {
  const who = c.creator && c.creator !== "unknown" ? `${c.creator}, ` : "";
  return `Photo: ${who}${c.license} (${c.source})`.slice(0, 140);
}

/** Which way a picture of this size should be searched. */
export function orientationFor(w: number, h: number): Orientation {
  const r = w / h;
  return r > 1.25 ? "wide" : r < 0.8 ? "tall" : "square";
}
