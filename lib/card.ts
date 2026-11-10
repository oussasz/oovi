// Designed images (create_image): a social post, poster, quote card or simple infographic,
// written as one self-contained HTML page that lib/render.ts screenshots with the local
// Chrome/Edge. The browser does the hard parts: Arabic shaping and right-to-left layout,
// line breaking, emoji. A small script shrinks the text until everything fits.
//
// Pure: type-only imports (unit-tested straight from the .ts file).

import type { ChartData } from "./charts";

export type CardStyle = "post" | "poster" | "quote" | "infographic";
export type PhotoLayout = "background" | "top" | "side" | "none";
export type CardPoint = { value?: string; label: string };
export type CardSpec = {
  style: CardStyle;
  width: number;
  height: number;
  headline: string;
  subheadline: string;
  body: string;
  points: CardPoint[];
  cta: string;
  footer: string;
  badge: string;
  colors: { bg: string; text: string; accent: string };
  photoLayout: PhotoLayout;
  font: "sans" | "serif";
  align: "start" | "center";
  dir: "rtl" | "ltr";
  lang: string;
};

export const CARD_STYLES: readonly CardStyle[] = ["post", "poster", "quote", "infographic"];
export const SIZES = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  landscape: [1920, 1080],
  story: [1080, 1920],
} as const satisfies Record<string, readonly [number, number]>;
export type SizeName = keyof typeof SIZES;

export const PALETTES = {
  warm: { bg: "#FFF4E6", text: "#3B2414", accent: "#E0662F" },
  coffee: { bg: "#2B1D16", text: "#F7EDE2", accent: "#D9A066" },
  fresh: { bg: "#EFFAF3", text: "#0F3D2E", accent: "#1FA36B" },
  bold: { bg: "#111111", text: "#FFFFFF", accent: "#FFD23F" },
  elegant: { bg: "#F6F1EA", text: "#1E1B18", accent: "#B08D57" },
  ocean: { bg: "#0B2545", text: "#FFFFFF", accent: "#4CC9F0" },
  pastel: { bg: "#FDF0F5", text: "#3D2C3E", accent: "#E86A92" },
  dark: { bg: "#16161A", text: "#F4F4F5", accent: "#7F5AF0" },
} as const;
export type PaletteName = keyof typeof PALETTES;

const MIN_SIDE = 256;
const MAX_SIDE = 2400;

const txt = (v: unknown, max: number) =>
  (v === null || v === undefined ? "" : String(v))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);

export function cssHex(v: unknown): string | null {
  const s = txt(v, 12).replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.replace(/./g, (c) => c + c).toUpperCase()}`;
  return null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Black or white, whichever reads better on this color. */
export const onColor = (hex: string) => (contrast(hex, "#FFFFFF") >= contrast(hex, "#111111") ? "#FFFFFF" : "#111111");

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/g;
const LETTERS = /\p{L}/gu;

/** Right-to-left when most letters are Arabic/Hebrew/Persian/Urdu. */
export function textDirection(s: string): "rtl" | "ltr" {
  const rtl = (s.match(RTL_CHARS) ?? []).length;
  const all = (s.match(LETTERS) ?? []).length;
  return rtl > 0 && rtl >= all * 0.3 ? "rtl" : "ltr";
}

function langOf(s: string, dir: "rtl" | "ltr"): string {
  if (dir === "rtl") return /[֐-׿]/.test(s) ? "he" : "ar";
  return /[àâçéèêëîïôûùüÿœæ]/i.test(s) ? "fr" : "en";
}

export function sizeOf(v: unknown, w?: unknown, h?: unknown): [number, number] {
  const clamp = (n: number) => Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, n)));
  if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) return [clamp(w), clamp(h)];
  const s = txt(v, 40).toLowerCase();
  if (s in SIZES) return [...SIZES[s as SizeName]];
  const m = s.match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/);
  if (m) return [clamp(Number(m[1])), clamp(Number(m[2]))];
  if (/story|stories|reel|tiktok|status|ستوري|9.?16/.test(s)) return [...SIZES.story];
  if (/portrait|vertical|flyer|poster|affiche|4.?5/.test(s)) return [...SIZES.portrait];
  if (/landscape|wide|youtube|cover|banner|slide|paysage|16.?9/.test(s)) return [...SIZES.landscape];
  if (/insta|facebook|fb|post|carr[ée]|square|مربع/.test(s)) return [...SIZES.square];
  return [...SIZES.square];
}

function pointsOf(v: unknown): CardPoint[] {
  if (!Array.isArray(v)) return [];
  const out: CardPoint[] = [];
  for (const p of v.slice(0, 8)) {
    if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      const label = txt(o.label ?? o.text ?? o.title, 160);
      const value = txt(o.value ?? o.number ?? o.stat, 24);
      if (label || value) out.push(value ? { value, label } : { label });
    } else {
      const label = txt(p, 160);
      if (label) out.push({ label });
    }
  }
  return out;
}

/** Validate and fill in an image request. Returns an error message when it can't be drawn. */
export function normalizeCard(raw: Record<string, unknown>, hasPhoto = false): CardSpec | string {
  const headline = txt(raw.headline ?? raw.title ?? raw.text, 300);
  if (!headline) return "headline is required (the main text of the image).";
  const styleRaw = txt(raw.style, 20).toLowerCase();
  const style: CardStyle = (CARD_STYLES as readonly string[]).includes(styleRaw) ? (styleRaw as CardStyle) : styleRaw === "flyer" || styleRaw === "announcement" ? "poster" : styleRaw === "stats" || styleRaw === "chart" ? "infographic" : "post";
  const [width, height] = sizeOf(raw.size, raw.width, raw.height);
  const subheadline = txt(raw.subheadline ?? raw.subtitle ?? raw.author, 300);
  const body = txt(raw.body, 900);
  const points = pointsOf(raw.points);
  const cta = txt(raw.cta ?? raw.call_to_action, 60);
  const footer = txt(raw.footer ?? raw.brand, 120);
  const badge = txt(raw.badge, 40);

  const paletteName = txt(raw.palette, 20).toLowerCase();
  const base = PALETTES[(paletteName in PALETTES ? paletteName : "warm") as PaletteName];
  const c = (raw.colors && typeof raw.colors === "object" ? raw.colors : {}) as Record<string, unknown>;
  const bg = cssHex(c.background ?? c.bg) ?? base.bg;
  let text = cssHex(c.text) ?? (cssHex(c.background ?? c.bg) ? onColor(bg) : base.text);
  if (contrast(text, bg) < 3) text = onColor(bg);
  const accent = cssHex(c.accent ?? c.primary) ?? base.accent;

  const all = [headline, subheadline, body, ...points.map((p) => p.label), cta, footer].join(" ");
  const dirRaw = txt(raw.direction, 4).toLowerCase();
  const dir = dirRaw === "rtl" || dirRaw === "ltr" ? dirRaw : textDirection(all);
  const layoutRaw = txt(raw.photo_layout, 12).toLowerCase();
  const photoLayout: PhotoLayout = !hasPhoto ? "none" : (["background", "top", "side"] as const).find((l) => l === layoutRaw) ?? (style === "poster" ? "top" : style === "infographic" ? "top" : width / height > 1.3 ? "side" : "background");
  const alignRaw = txt(raw.align, 8).toLowerCase();
  return {
    style,
    width,
    height,
    headline,
    subheadline,
    body,
    points,
    cta,
    footer,
    badge,
    colors: { bg, text, accent },
    photoLayout,
    font: txt(raw.font, 10).toLowerCase() === "serif" || (style === "quote" && txt(raw.font, 10).toLowerCase() !== "sans") ? "serif" : "sans",
    align: alignRaw === "center" || alignRaw === "start" ? alignRaw : style === "quote" || style === "poster" ? "center" : "start",
    dir,
    lang: langOf(all, dir),
  };
}

// ---------- HTML ----------

export const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
const lines = (s: string) => escHtml(s).replace(/\n/g, "<br>");

const SANS = `"Segoe UI", "Noto Sans", "Noto Sans Arabic", "SF Arabic", "Helvetica Neue", Arial, Tahoma, "Geeza Pro", sans-serif`;
const SERIF = `Georgia, "Noto Serif", "Noto Naskh Arabic", "Times New Roman", "Traditional Arabic", serif`;

export function formatValue(n: number | null, fmt?: string): string {
  if (n === null) return "";
  if (fmt && fmt.includes("%")) return `${(n * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Chart drawn with HTML/SVG (bars as boxes so labels shape and flip like any text). */
export function chartHtml(c: ChartData, colors: { text: string; accent: string }): string {
  const s = c.series[0];
  if (!s) return "";
  const n = Math.min(c.categories.length, 10);
  const cats = c.categories.slice(0, n);
  const vals = s.values.slice(0, n);
  const max = Math.max(...vals.map((v) => Math.abs(v ?? 0)), 0) || 1;
  const col = (i: number) => `#${c.colors[i % c.colors.length] ?? "4F6BED"}`;
  const title = c.title ? `<div class="ch-title">${escHtml(c.title)}</div>` : "";
  if (c.type === "pie" || c.type === "doughnut") {
    const total = vals.reduce<number>((a, v) => a + Math.max(0, v ?? 0), 0) || 1;
    let acc = 0;
    const R = 40;
    const C = 2 * Math.PI * R;
    const arcs = vals
      .map((v, i) => {
        const frac = Math.max(0, v ?? 0) / total;
        const seg = `<circle r="${R}" cx="50" cy="50" fill="none" stroke="${col(i)}" stroke-width="${c.type === "doughnut" ? 18 : 40}" stroke-dasharray="${(frac * C).toFixed(3)} ${C.toFixed(3)}" stroke-dashoffset="${(-acc * C).toFixed(3)}" transform="rotate(-90 50 50)"/>`;
        acc += frac;
        return seg;
      })
      .join("");
    const legend = cats.map((cat, i) => `<div class="lg"><i style="background:${col(i)}"></i><span>${escHtml(cat)}</span><b>${Math.round((Math.max(0, vals[i] ?? 0) / total) * 100)}%</b></div>`).join("");
    return `<div class="chart pie">${title}<div class="pie-row"><svg viewBox="0 0 100 100" class="pie-svg">${arcs}</svg><div class="legend">${legend}</div></div></div>`;
  }
  if (c.type === "bar") {
    const rows = cats.map((cat, i) => `<div class="hb"><span class="hb-l">${escHtml(cat)}</span><span class="hb-t"><i style="width:${((Math.abs(vals[i] ?? 0) / max) * 100).toFixed(1)}%;background:${col(0)}"></i></span><b>${formatValue(vals[i] ?? null, c.numberFormat)}</b></div>`).join("");
    return `<div class="chart">${title}<div class="hbars">${rows}</div></div>`;
  }
  if (c.type === "line" || c.type === "area") {
    const pts = vals.map((v, i) => `${n === 1 ? 50 : (i / (n - 1)) * 100},${(96 - (Math.max(0, v ?? 0) / max) * 88).toFixed(2)}`);
    const area = c.type === "area" ? `<polygon points="0,100 ${pts.join(" ")} 100,100" fill="${col(0)}" opacity=".25"/>` : "";
    const labels = cats.map((cat) => `<span>${escHtml(cat)}</span>`).join("");
    return `<div class="chart">${title}<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="line-svg">${area}<polyline points="${pts.join(" ")}" fill="none" stroke="${col(0)}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg><div class="xl" dir="ltr">${labels}</div></div>`;
  }
  const bars = cats.map((cat, i) => `<div class="vb"><b>${formatValue(vals[i] ?? null, c.numberFormat)}</b><i style="height:${((Math.abs(vals[i] ?? 0) / max) * 100).toFixed(1)}%;background:${col(0)}"></i><span>${escHtml(cat)}</span></div>`).join("");
  return `<div class="chart">${title}<div class="vbars">${bars}</div></div>`;
}

const QUOTE_SVG = `<svg viewBox="0 0 64 48" class="qmark" aria-hidden="true"><path fill="currentColor" d="M0 48V28C0 12 8 3 24 0l3 6C18 9 14 14 13 22h11v26H0zm37 0V28C37 12 45 3 61 0l3 6c-9 3-13 8-14 16h11v26H37z"/></svg>`;

export type CardExtras = { photo?: { dataUri: string; credit?: string }; chart?: ChartData };

export function cardHtml(spec: CardSpec, extras: CardExtras = {}): string {
  const { width: W, height: H, colors, style, dir } = spec;
  const u = Math.min(W, H) / 1080;
  const px = (n: number) => `${(n * u).toFixed(1)}px`;
  const photo = spec.photoLayout !== "none" && extras.photo ? extras.photo : undefined;
  const layout = photo ? spec.photoLayout : "none";
  const onPhoto = layout === "background";
  const text = onPhoto ? "#FFFFFF" : colors.text;
  const accent = colors.accent;
  const onAccent = onColor(accent);
  const len = spec.headline.length;
  const big = style === "poster" ? 1.18 : style === "quote" ? 0.82 : style === "infographic" ? 0.8 : 1;
  const hSize = (len <= 18 ? 118 : len <= 36 ? 98 : len <= 64 ? 80 : len <= 110 ? 64 : len <= 180 ? 54 : 46) * big;
  const arabic = dir === "rtl";
  const center = spec.align === "center";
  const pad = W / H > 1.3 ? 96 : 84;

  const badge = spec.badge ? `<div class="badge" dir="auto">${escHtml(spec.badge)}</div>` : "";
  const rule = style !== "quote" && style !== "infographic" ? `<div class="rule"></div>` : "";
  const sub = spec.subheadline ? (style === "quote" ? `<div class="author"><span class="dash"></span><bdi>${escHtml(spec.subheadline)}</bdi></div>` : `<div class="sub">${lines(spec.subheadline)}</div>`) : "";
  const body = spec.body ? `<div class="body">${lines(spec.body)}</div>` : "";
  const stats = spec.points.length && spec.points.every((p) => p.value);
  const points = !spec.points.length
    ? ""
    : stats
      ? `<div class="stats n${Math.min(spec.points.length, 4)}">${spec.points.map((p) => `<div class="stat"><div class="sv" dir="auto">${escHtml(p.value!)}</div><div class="sl">${lines(p.label)}</div></div>`).join("")}</div>`
      : style === "infographic"
        ? `<ol class="steps">${spec.points.map((p, i) => `<li><span class="num">${i + 1}</span><span>${p.value ? `<bdi><b>${escHtml(p.value)}</b></bdi> ` : ""}${lines(p.label)}</span></li>`).join("")}</ol>`
        : `<ul class="points">${spec.points.map((p) => `<li><span class="tick"></span><span>${p.value ? `<bdi><b>${escHtml(p.value)}</b></bdi> ` : ""}${lines(p.label)}</span></li>`).join("")}</ul>`;
  const chart = extras.chart ? chartHtml(extras.chart, { text, accent }) : "";
  const cta = spec.cta ? `<div class="cta" dir="auto">${escHtml(spec.cta)}</div>` : "";
  const footer = spec.footer ? `<footer><span class="fdot"></span><span>${escHtml(spec.footer)}</span></footer>` : "";
  const headline = `<h1>${lines(spec.headline)}</h1>`;

  let stack: string;
  if (style === "quote") stack = `${QUOTE_SVG}${headline}${sub}${body}${points}${cta}`;
  else if (style === "infographic") stack = `${badge}${headline}${sub}${body}${chart}${points}${cta}`;
  else stack = `${badge}${rule}${headline}${sub}${body}${chart}${points}${cta}`;

  const photoBg = layout === "background" ? `<div class="bgimg"></div><div class="shade"></div>` : "";
  const photoPane = layout === "top" || layout === "side" ? `<div class="pic"></div>` : "";
  const deco = !photo && style !== "infographic" ? `<div class="deco d1"></div><div class="deco d2"></div>` : "";
  const credit = photo?.credit ? `<div class="credit">${escHtml(photo.credit)}</div>` : "";

  const vAlign = style === "quote" || style === "poster" || !onPhoto ? "center" : "end";
  const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
:root{--fit:1}
body{position:relative;background:${colors.bg};color:${text};font-family:${spec.font === "serif" ? SERIF : SANS};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-wrap:anywhere;word-break:normal}
.bgimg,.pic{background:#222 ${photo ? `url("${photo.dataUri}")` : ""} center/cover no-repeat}
.bgimg{position:absolute;inset:0}
.shade{position:absolute;inset:0;background:${vAlign === "end" ? "linear-gradient(to top,rgba(0,0,0,.82) 0%,rgba(0,0,0,.55) 45%,rgba(0,0,0,.12) 100%)" : "linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,.62))"}}
.deco{position:absolute;border-radius:50%;pointer-events:none}
.d1{width:${px(620)};height:${px(620)};background:${accent};opacity:.13;top:${px(-210)};inset-inline-end:${px(-190)}}
.d2{width:${px(260)};height:${px(260)};border:${px(26)} solid ${accent};opacity:.22;bottom:${px(-80)};inset-inline-start:${px(-70)}}
.wrap{position:absolute;inset:0;display:flex;flex-direction:${layout === "top" ? "column" : "row"}}
.pic{flex:0 0 ${layout === "top" ? (style === "infographic" ? "34%" : "48%") : "46%"};${layout === "side" ? "order:2" : ""}}
.pane{flex:1;min-width:0;min-height:0;position:relative;display:flex;flex-direction:column;padding:${px(pad)}${style === "infographic" ? ";padding-top:0" : ""}}
#content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.stack{display:flex;flex-direction:column;gap:${px(26)};margin-block:${vAlign === "end" ? "auto 0" : "auto"};${center ? "align-items:center;text-align:center" : "align-items:flex-start;text-align:start"}}
h1{font-size:calc(${px(hSize)} * var(--fit));line-height:${arabic ? 1.35 : 1.08};font-weight:800;${arabic ? "" : `letter-spacing:${len <= 36 ? "-0.02em" : "-0.01em"};`}max-width:100%${onPhoto ? ";text-shadow:0 2px 18px rgba(0,0,0,.35)" : ""}}
.sub{font-size:calc(${px(style === "poster" ? 46 : 42)} * var(--fit));line-height:${arabic ? 1.55 : 1.3};font-weight:500;opacity:.92;max-width:100%}
.body{font-size:calc(${px(34)} * var(--fit));line-height:${arabic ? 1.7 : 1.45};opacity:.88;max-width:${center ? "92%" : "100%"}}
.badge{background:${accent};color:${onAccent};font-weight:700;font-size:calc(${px(30)} * var(--fit));padding:${px(10)} ${px(26)};border-radius:999px;line-height:1.3}
.rule{width:${px(110)};height:${px(10)};border-radius:${px(5)};background:${accent}}
.points{list-style:none;display:flex;flex-direction:column;gap:${px(16)};font-size:calc(${px(36)} * var(--fit));line-height:${arabic ? 1.55 : 1.3};text-align:start;align-self:${center ? "center" : "stretch"}}
.points li{display:flex;align-items:baseline;gap:${px(18)}}
.tick{flex:0 0 auto;width:${px(18)};height:${px(18)};border-radius:50%;background:${accent};transform:translateY(-${px(3)})}
.steps{list-style:none;display:flex;flex-direction:column;gap:${px(18)};font-size:calc(${px(36)} * var(--fit));line-height:${arabic ? 1.55 : 1.3};text-align:start;align-self:stretch}
.steps li{display:flex;align-items:center;gap:${px(22)};background:${onPhoto ? "rgba(255,255,255,.12)" : "rgba(127,127,127,.09)"};border-radius:${px(22)};padding:${px(20)} ${px(26)}}
.num{flex:0 0 auto;width:${px(64)};height:${px(64)};border-radius:50%;background:${accent};color:${onAccent};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:calc(${px(32)} * var(--fit))}
.stats{display:grid;gap:${px(22)};align-self:stretch;grid-template-columns:repeat(2,1fr)}
.stats.n1{grid-template-columns:1fr}.stats.n3{grid-template-columns:repeat(${W / H > 1.3 ? 3 : 1},1fr)}.stats.n4{grid-template-columns:repeat(${W / H > 1.3 ? 4 : 2},1fr)}
.stat{background:${onPhoto ? "rgba(255,255,255,.12)" : "rgba(127,127,127,.09)"};border-radius:${px(26)};padding:${px(26)} ${px(30)};text-align:start;border-inline-start:${px(10)} solid ${accent}}
.sv{font-size:calc(${px(78)} * var(--fit));font-weight:800;line-height:1.1;color:${onPhoto ? "#FFFFFF" : accent}}
.sl{font-size:calc(${px(30)} * var(--fit));line-height:${arabic ? 1.5 : 1.3};opacity:.85;margin-top:${px(6)}}
.cta{background:${accent};color:${onAccent};font-weight:700;font-size:calc(${px(36)} * var(--fit));padding:${px(20)} ${px(46)};border-radius:999px;line-height:1.25;box-shadow:0 ${px(8)} ${px(24)} rgba(0,0,0,.18)}
footer{display:flex;align-items:center;gap:${px(14)};margin-top:${px(30)};font-size:${px(30)};font-weight:600;opacity:.9;${center ? "justify-content:center" : ""}}
.fdot{width:${px(14)};height:${px(14)};border-radius:50%;background:${accent}}
.qmark{width:${px(130)};height:${px(98)};color:${accent}}
.author{display:flex;align-items:center;gap:${px(18)};font-size:calc(${px(38)} * var(--fit));font-weight:600;opacity:.9;font-family:${SANS}}
.dash{width:${px(56)};height:${px(4)};background:${accent};border-radius:2px}
${style === "infographic" ? `.head{flex:0 0 auto;background:${accent};color:${onAccent};margin:0 ${px(-pad)} ${px(30)};padding:${px(pad * 0.9)} ${px(pad)} ${px(pad * 0.65)};display:flex;flex-direction:column;gap:${px(18)};${center ? "align-items:center;text-align:center" : "align-items:flex-start;text-align:start"}}.head .badge{background:${onAccent};color:${accent}}` : ""}
.chart{align-self:stretch;display:flex;flex-direction:column;gap:${px(14)};font-family:${SANS}}
.ch-title{font-size:calc(${px(32)} * var(--fit));font-weight:700;opacity:.9}
.hbars{display:flex;flex-direction:column;gap:${px(14)}}
.hb{display:grid;grid-template-columns:minmax(0,30%) 1fr auto;align-items:center;gap:${px(16)};font-size:calc(${px(28)} * var(--fit))}
.hb-t{height:${px(34)};background:rgba(127,127,127,.15);border-radius:${px(10)};overflow:hidden;display:block}
.hb-t i{display:block;height:100%;border-radius:${px(10)}}
.vbars{display:flex;align-items:flex-end;gap:${px(18)};height:calc(${px(360)} * var(--fit))}
.vb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:${px(8)};font-size:calc(${px(24)} * var(--fit));min-width:0}
.vb i{display:block;width:100%;border-radius:${px(10)} ${px(10)} 0 0;min-height:2px}
.vb span{opacity:.85;text-align:center;line-height:1.2;max-width:100%}
.line-svg{width:100%;height:calc(${px(300)} * var(--fit))}
.xl{display:flex;justify-content:space-between;font-size:calc(${px(22)} * var(--fit));opacity:.85}
.pie-row{display:flex;align-items:center;gap:${px(40)}}
.pie-svg{width:calc(${px(330)} * var(--fit));height:calc(${px(330)} * var(--fit));flex:0 0 auto}
.legend{display:flex;flex-direction:column;gap:${px(12)};font-size:calc(${px(28)} * var(--fit))}
.lg{display:flex;align-items:center;gap:${px(14)}}.lg i{width:${px(22)};height:${px(22)};border-radius:${px(6)};flex:0 0 auto}.lg b{margin-inline-start:${px(6)}}
.credit{position:absolute;bottom:${px(14)};inset-inline-end:${px(20)};font-size:${px(16)};color:#fff;opacity:.78;text-shadow:0 1px 4px rgba(0,0,0,.7);font-family:${SANS};max-width:60%;direction:ltr}
`;
  const headBlock = style === "infographic" ? `<div class="head">${badge}${headline}${sub}</div>` : "";
  const mainStack = style === "infographic" ? `<div class="stack" style="margin-block:${px(20)} auto">${body}${chart}${points}${cta}</div>` : `<div class="stack">${stack}</div>`;
  const fit = `
(function(){
  var root=document.documentElement, box=document.getElementById('content'), stacks=box.children;
  function over(){var h=0;for(var i=0;i<stacks.length;i++){h+=stacks[i].getBoundingClientRect().height;if(stacks[i].scrollWidth>stacks[i].clientWidth+2)return true}return h>box.getBoundingClientRect().height+1}
  function run(){var f=1,n=0;while(over()&&n<45){f*=0.94;root.style.setProperty('--fit',f.toFixed(4));n++}document.body.setAttribute('data-ready','1')}
  (document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(run,run);
})();`;
  return `<!doctype html><html lang="${spec.lang}" dir="${dir}"><head><meta charset="utf-8"><style>${css}</style></head><body>${photoBg}${deco}<div class="wrap">${photoPane}<div class="pane">${headBlock}<div id="content">${mainStack}</div>${footer}</div></div>${credit}<script>${fit}</script></body></html>`;
}
