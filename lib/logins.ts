// Saved logins (Settings > Saved logins): a site, a username, a password and, optionally, the key of its
// two-step codes. Kept encrypted in the account's folder. Bots never see the password or the codes: the
// fill_login tool types them into the bots' browser itself, and every tool result is cleaned of them.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, decryptSecret, encryptSecret } from "./settings";
import { base32, keyFromSetup, siteMatches, siteOf, totp } from "./totp-core";

type Stored = { id: string; site: string; username: string; password: string; totp?: string; createdAt: number };
export type LoginView = { id: string; site: string; username: string; hasCode: boolean; createdAt: number };
export const MAX_LOGINS = 100;

const file = () => path.join(dataDir(), "logins.json");

function readAll(): Stored[] {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8")) as { logins?: Stored[] };
    return Array.isArray(j.logins) ? j.logins.filter((x) => x && typeof x.site === "string" && typeof x.password === "string") : [];
  } catch {
    return [];
  }
}
function writeAll(list: Stored[]) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ logins: list }), { mode: 0o600 });
}

export const listLogins = (): LoginView[] => readAll().map((l) => ({ id: l.id, site: l.site, username: l.username, hasCode: !!l.totp, createdAt: l.createdAt }));

/** Sites with a saved login (what bots are told: never usernames or passwords). */
export const loginSites = (): string[] => [...new Set(readAll().map((l) => l.site))].sort();

export function addLogin(input: { site?: unknown; username?: unknown; password?: unknown; code?: unknown }): LoginView | string {
  const site = siteOf(String(input.site ?? ""));
  if (!site) return "Write the site's address, e.g. facebook.com.";
  const username = String(input.username ?? "").trim().slice(0, 200);
  const password = String(input.password ?? "");
  if (!username) return "Write the username or email.";
  if (!password || password.length > 500) return "Write the password.";
  const rawCode = String(input.code ?? "").trim();
  const key = rawCode ? keyFromSetup(rawCode) : null;
  if (rawCode && !key) return "The two-step key should be the setup key (letters A-Z and digits 2-7) or an otpauth:// link.";
  const all = readAll();
  if (all.length >= MAX_LOGINS) return `At most ${MAX_LOGINS} saved logins.`;
  const l: Stored = { id: crypto.randomBytes(6).toString("hex"), site, username, password: encryptSecret(password), ...(key ? { totp: encryptSecret(key) } : {}), createdAt: Date.now() };
  // One login per site and username: saving again replaces it.
  writeAll([...all.filter((x) => !(x.site === site && x.username.toLowerCase() === username.toLowerCase())), l]);
  return { id: l.id, site, username, hasCode: !!key, createdAt: l.createdAt };
}

export function deleteLogin(id: string): boolean {
  const all = readAll();
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

export type Secret = { site: string; username: string; password: string; code: () => string | null };

/** The saved login for a page's host (the one asked for by username when there are several). */
export function loginFor(host: string, username?: string): Secret | null {
  const hits = readAll().filter((l) => siteMatches(host, l.site));
  const l = (username ? hits.find((x) => x.username.toLowerCase() === username.toLowerCase()) : undefined) ?? hits.sort((a, b) => b.site.length - a.site.length)[0];
  if (!l) return null;
  return {
    site: l.site,
    username: l.username,
    password: decryptSecret(l.password),
    code: () => {
      if (!l.totp) return null;
      const k = base32(decryptSecret(l.totp));
      return k ? totp(k) : null;
    },
  };
}

/** Every saved password and the current codes, for cleaning tool results (never shown to a bot). */
export function secretsToHide(): string[] {
  const out: string[] = [];
  for (const l of readAll()) {
    try {
      const p = decryptSecret(l.password);
      if (p.length >= 4) out.push(p);
      if (l.totp) {
        const k = base32(decryptSecret(l.totp));
        if (k) for (const dt of [-30_000, 0, 30_000]) out.push(totp(k, Date.now() + dt));
      }
    } catch {
      /* a login saved with another key: skipped */
    }
  }
  return out;
}

export function hideSecrets(text: string, secrets: string[]): string {
  let t = text;
  for (const s of secrets) if (s && t.includes(s)) t = t.split(s).join("••••••");
  return t;
}
