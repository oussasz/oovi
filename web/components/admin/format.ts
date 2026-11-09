// Formatting helpers for the admin console. Dates are shown in UTC so every
// admin sees the same numbers.

const intFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const smallUsdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export const fmtInt = (v: number) => intFmt.format(Math.round(v));
export const fmtCompact = (v: number) => (Math.abs(v) < 1000 ? fmtNumber(v) : compactFmt.format(v));
export const fmtUsd = (v: number) => (v !== 0 && Math.abs(v) < 1 ? smallUsdFmt : usdFmt).format(v);
export function fmtNumber(v: number, digits = 1): string {
  if (Number.isInteger(v)) return intFmt.format(v);
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}
export const fmtPct = (v: number | null) => (v === null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(v >= 0.995 || v === 0 ? 0 : 1)}%`);

export function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : dateFmt.format(d);
}
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : `${dateTimeFmt.format(d)} UTC`;
}
/** "2026-11-03" -> "Nov 3" */
export function fmtDay(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? key : dayFmt.format(d);
}
export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "–";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  return fmtDate(iso);
}

export const PLATFORM_LABELS: Record<string, string> = {
  win32: "Windows",
  darwin: "Mac",
  linux: "Linux",
  unknown: "Unknown",
};
export const platformLabel = (p: string | null) => (p ? (PLATFORM_LABELS[p] ?? p) : "–");

export const TARGET_LABELS: Record<string, string> = {
  "mac-arm64": "Mac (Apple silicon)",
  "mac-intel": "Mac (Intel)",
  windows: "Windows",
};

/** Series colors from the site palette (they adapt to dark mode). */
export const TARGET_COLORS: Record<string, string> = {
  "mac-arm64": "var(--blue-ink)",
  "mac-intel": "var(--lilac)",
  windows: "var(--coral)",
};

export function countryName(code: string): string {
  if (!code) return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
