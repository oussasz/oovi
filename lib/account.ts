// The oovi account: you sign in with the account you created on the oovi
// website. The session token is encrypted with a key that never leaves this
// computer. Everything (bots, chats, skills, memory, keys) lives in a folder
// per account: <data>/accounts/<userId>/. Sync between devices is a future
// paid feature and is not part of this version.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Where the account website / API lives. */
export const DEFAULT_CLOUD_URL = "https://oovi.conuron.com";
export const cloudUrl = () => (process.env.OOVI_CLOUD_URL || DEFAULT_CLOUD_URL).replace(/\/+$/, "");

export type AccountUser = { id: string; email: string; name: string; image: string | null; createdAt?: string };
type Session = { token: string; user: AccountUser; onboarded: boolean; savedAt: number };

export const baseDir = () => process.env.OOVI_DATA || path.join(process.cwd(), "data");
const sessionFile = () => path.join(baseDir(), "session.json");

function deviceKey(): Buffer {
  fs.mkdirSync(baseDir(), { recursive: true });
  const p = path.join(baseDir(), ".device-key");
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(p, "utf8").trim(), "hex");
}

function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", deviceKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

function unseal(stored: string): string | null {
  try {
    const [v, iv, tag, ct] = stored.split(":");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", deviceKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

let cache: { mtime: number; session: Session | null } | null = null;

export function currentSession(): Session | null {
  try {
    const st = fs.statSync(sessionFile());
    if (cache && cache.mtime === st.mtimeMs) return cache.session;
    const s = JSON.parse(fs.readFileSync(sessionFile(), "utf8")) as Session;
    const session = s?.user?.id && s.token ? s : null;
    cache = { mtime: st.mtimeMs, session };
    return session;
  } catch {
    cache = null;
    return null;
  }
}

export const currentUser = () => currentSession()?.user ?? null;
export const sessionToken = () => {
  const s = currentSession();
  return s ? unseal(s.token) : null;
};

const safeId = (id: string) => id.replace(/[^\w-]/g, "_").slice(0, 80);

/** This account's data folder, or null when signed out. */
export function accountDir(): string | null {
  const u = currentUser();
  return u ? path.join(baseDir(), "accounts", safeId(u.id)) : null;
}

function writeSession(s: Session) {
  fs.mkdirSync(baseDir(), { recursive: true });
  fs.writeFileSync(sessionFile(), JSON.stringify(s, null, 1), { mode: 0o600 });
  cache = null;
}

export function saveSession(token: string, user: AccountUser): void {
  const prev = currentSession();
  writeSession({ token: seal(token), user, onboarded: prev?.user.id === user.id ? prev.onboarded : hasAccountData(user.id), savedAt: Date.now() });
  migrateLegacyData(user.id);
}

export function updateSessionUser(user: AccountUser): void {
  const s = currentSession();
  if (s) writeSession({ ...s, user, savedAt: Date.now() });
}

export function setOnboarded(done = true): void {
  const s = currentSession();
  if (s) writeSession({ ...s, onboarded: done, savedAt: Date.now() });
}

export function clearSession(): void {
  fs.rmSync(sessionFile(), { force: true });
  cache = null;
}

function hasAccountData(userId: string) {
  return fs.existsSync(path.join(baseDir(), "accounts", safeId(userId), "bots.json"));
}

/** Data created before accounts existed moves into the first account that signs in. */
function migrateLegacyData(userId: string) {
  const base = baseDir();
  const target = path.join(base, "accounts", safeId(userId));
  if (fs.existsSync(path.join(target, "bots.json")) || !fs.existsSync(path.join(base, "bots.json"))) return;
  fs.mkdirSync(target, { recursive: true });
  const items = ["bots.json", "chats", "skills", "memory", "settings.json", ".secret", "mcp.json", "shots", "history.json", "accounts.json", "browser-profile", "downloads"];
  for (const name of items) {
    const from = path.join(base, name);
    if (!fs.existsSync(from)) continue;
    try {
      fs.renameSync(from, path.join(target, name));
    } catch {
      /* best effort: leave it in place */
    }
  }
  const s = currentSession();
  if (s) writeSession({ ...s, onboarded: true, savedAt: Date.now() });
}

// ---------- talking to the account service ----------

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The app version, e.g. "0.7.0" (Electron sets OOVI_VERSION). */
export const appVersion = () => process.env.OOVI_VERSION || process.env.npm_package_version || "dev";

export async function cloud<T>(route: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  // The version and OS let the oovi team see which versions are in use (no personal data).
  const headers: Record<string, string> = { accept: "application/json", "x-oovi-version": appVersion(), "x-oovi-platform": process.platform };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.auth) {
    const t = sessionToken();
    if (!t) throw new CloudError("You're signed out.", 401);
    headers.authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(`${cloudUrl()}${route}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new CloudError("Can't reach the oovi account service. Check your internet connection.", 0);
  }
  if (res.status === 204) return undefined as T;
  let j: unknown = null;
  try {
    j = await res.json();
  } catch {
    j = null;
  }
  if (!res.ok) throw new CloudError((j as { error?: string } | null)?.error || `Account service error (${res.status}).`, res.status);
  return j as T;
}
