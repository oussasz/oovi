// Small, strict FormData readers for server actions. Every value is checked here,
// never trusted from the browser.

export function fdStr(fd: FormData, key: string, max = 2000): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function fdBool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

/**
 * Reads a number between min and max. Pushes a plain-English problem into `errors`
 * and returns null when it's missing or out of range.
 */
export function fdNum(
  fd: FormData,
  key: string,
  label: string,
  errors: string[],
  opts: { min: number; max: number; integer?: boolean; optional?: boolean },
): number | null {
  const raw = fdStr(fd, key, 40).trim().replace(/,/g, "");
  if (raw === "") {
    if (!opts.optional) errors.push(`${label} is required.`);
    return null;
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    errors.push(`${label} must be a number.`);
    return null;
  }
  if (opts.integer && !Number.isInteger(v)) {
    errors.push(`${label} must be a whole number.`);
    return null;
  }
  if (v < opts.min || v > opts.max) {
    errors.push(`${label} must be between ${opts.min.toLocaleString("en-US")} and ${opts.max.toLocaleString("en-US")}.`);
    return null;
  }
  return v;
}

/** A same-site path to send someone back to after signing in, or null. */
export function safeNext(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 200) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (!/^\/[A-Za-z0-9\-._~/?=&%]*$/.test(v)) return null;
  return v;
}

export const ID_RE = /^\d{1,18}$/;
