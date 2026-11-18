// Two-step codes (TOTP, RFC 6238) from a saved login's setup key, so a bot can finish a sign-in without the
// user reading the code off their phone. Pure: tests/unit/totp.test.mts.
import crypto from "node:crypto";

/** A base32 setup key ("JBSW Y3DP EHPK 3PXP") as bytes; null when it isn't valid base32. */
export function base32(key: string): Buffer | null {
  const clean = key.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return null;
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code at `now` (ms): 6 digits, 30-second steps, SHA-1 (what almost every site uses). */
export function totp(key: Buffer, now = Date.now(), digits = 6, step = 30, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const counter = Math.floor(now / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo, key).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const bin = ((h[off]! & 127) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** A setup key from an otpauth:// link or the bare key. */
export function keyFromSetup(input: string): string | null {
  const t = input.trim();
  if (/^otpauth:\/\//i.test(t)) {
    try {
      return new URL(t).searchParams.get("secret");
    } catch {
      return null;
    }
  }
  return base32(t) ? t.replace(/[\s-]/g, "").toUpperCase() : null;
}

/** "accounts.google.com", "https://www.facebook.com/login" → the host a saved login belongs to (no "www."). */
export function siteOf(input: string): string | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`);
    // A domain, or a local address (a router, a dashboard on this network).
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(u.hostname) && !/^(localhost|\d{1,3}(\.\d{1,3}){3})$/.test(u.hostname)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A page's host matches a saved site: the same host, or a subdomain of it (login.example.com for example.com). */
export const siteMatches = (pageHost: string, site: string) => {
  const h = pageHost.toLowerCase().replace(/^www\./, "");
  return h === site || h.endsWith(`.${site}`);
};
