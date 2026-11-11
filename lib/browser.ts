// Browsers for the bots.
//
// Two kinds of session:
// - Private (default): a fresh, empty browser per chat + bot. No cookies, no logins.
//   Local headless Chrome/Edge, or the Docker sandbox.
// - Accounts: bots that have "Use my accounts" share ONE saved browser profile
//   that the user signed into themselves (openSignInWindow). Each bot gets its
//   own tab. The AI never sees passwords; it only reuses the signed-in session.
//
// Requests to localhost / private networks are blocked unless allowed in Settings.
// Downloads are saved to the user's Downloads/oovi folder and never opened.

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { dataDir, type BrowserConfig } from "./settings";

export type ElementInfo = { kind: string; label: string };
export type Session = {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  key: string;
  /** Uses the shared signed-in profile. */
  shared: boolean;
  lastUsed: number;
  /** Numbered elements from the latest page snapshot (see tools.ts). */
  elements: Map<number, ElementInfo>;
  downloads: string[];
  pending: Promise<unknown>[];
};

const IDLE_MS = 15 * 60_000;
type Shared = { context: BrowserContext; key: string };
const g = globalThis as typeof globalThis & {
  __ooviSessions?: Map<string, Session>;
  __ooviSweep?: ReturnType<typeof setInterval>;
  __ooviShared?: Shared | null;
  __ooviSignIn?: BrowserContext | null;
};
const sessions = (g.__ooviSessions ??= new Map<string, Session>());
if (!g.__ooviSweep) {
  g.__ooviSweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastUsed > IDLE_MS) void closeSession(id);
  }, 60_000);
  g.__ooviSweep.unref?.();
}

export const profileDir = () => path.join(dataDir(), "browser-profile");
export const downloadsDir = () => process.env.OOVI_DOWNLOADS || path.join(dataDir(), "downloads");
const accountsFile = () => path.join(dataDir(), "accounts.json");

// ---------- network rules ----------

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(h)) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  return false;
}

/** Returns an error message if the agent may not navigate to this URL, else null. */
export function checkUrl(url: string, allowPrivate: boolean): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `Not a valid URL: ${url}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `Only http(s) URLs are allowed (got ${u.protocol}).`;
  if (!allowPrivate && isPrivateHost(u.hostname)) return `Blocked: ${u.hostname} is a local/private address. Enable "Allow local network" in Settings if you really want this.`;
  return null;
}

function requestAllowed(url: string): boolean {
  if (/^(data|blob|about):/i.test(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

const blockPrivate = (c: BrowserContext) => c.route("**/*", (route) => (requestAllowed(route.request().url()) ? route.continue() : route.abort("blockedbyclient")));

// ---------- launching ----------

const channelsFor = (channel: BrowserConfig["channel"]): (string | undefined)[] =>
  channel === "auto" ? ["chrome", "msedge", undefined] : [channel === "chromium" ? undefined : channel];

/**
 * Linux: browsers the usual places Playwright's "chrome"/"msedge" channels don't look in
 * (Chromium from the distribution or snap, Brave, Chrome under another name). Tried after the channels.
 */
const LINUX_BROWSERS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/usr/bin/microsoft-edge-stable",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
  "/var/lib/flatpak/exports/bin/com.google.Chrome",
  "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
];
export const linuxBrowser = (): string | undefined => (process.platform === "linux" ? LINUX_BROWSERS.find((p) => fs.existsSync(p)) : undefined);

/** "auto" tries installed Chrome, then Edge, then Playwright's own Chromium. */
export async function launchLocal(channel: BrowserConfig["channel"]): Promise<Browser> {
  let lastErr: unknown;
  for (const ch of channelsFor(channel)) {
    try {
      return await chromium.launch({ headless: true, ...(ch ? { channel: ch } : {}) });
    } catch (e) {
      lastErr = e;
    }
  }
  const exe = linuxBrowser();
  if (exe) {
    try {
      return await chromium.launch({ headless: true, executablePath: exe });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function launchProfile(channel: BrowserConfig["channel"], headless: boolean): Promise<BrowserContext> {
  fs.mkdirSync(profileDir(), { recursive: true });
  let lastErr: unknown;
  for (const ch of channelsFor(channel)) {
    try {
      return await chromium.launchPersistentContext(profileDir(), {
        headless,
        ...(ch ? { channel: ch } : {}),
        acceptDownloads: true,
        viewport: headless ? { width: 1280, height: 800 } : null,
        locale: "en-US",
      });
    } catch (e) {
      lastErr = e;
    }
  }
  const exe = linuxBrowser();
  if (exe) {
    try {
      return await chromium.launchPersistentContext(profileDir(), { headless, executablePath: exe, acceptDownloads: true, viewport: headless ? { width: 1280, height: 800 } : null, locale: "en-US" });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- downloads & tabs ----------

const safeName = (n: string) => n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").slice(0, 120) || "download";

function uniquePath(dir: string, name: string) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

/** Save this page's downloads, and follow pop-up tabs it opens. */
function track(sess: Session, page: Page) {
  page.on("download", (d) => {
    const job = (async () => {
      const dir = downloadsDir();
      fs.mkdirSync(dir, { recursive: true });
      const target = uniquePath(dir, safeName(d.suggestedFilename()));
      await d.saveAs(target);
      sess.downloads.push(target);
    })().catch((e: unknown) => {
      sess.downloads.push(`(download failed: ${(e as Error).message})`);
    });
    sess.pending.push(job);
  });
  page.on("popup", (p) => {
    sess.page = p;
    sess.elements.clear();
    track(sess, p);
    // A sign-in pop-up that closes itself (e.g. "Sign in with Google") returns to the page that opened it.
    p.once("close", () => {
      if (sess.page === p && !page.isClosed()) {
        sess.page = page;
        sess.elements.clear();
      }
    });
  });
}

/** Files saved since the last call (waits for downloads still in progress). */
export async function takeDownloads(sess: Session, waitMs = 60_000): Promise<string[]> {
  if (sess.pending.length) {
    await Promise.race([Promise.allSettled(sess.pending), new Promise((r) => setTimeout(r, waitMs))]);
    sess.pending = [];
  }
  const out = sess.downloads;
  sess.downloads = [];
  return out;
}

// ---------- the shared signed-in profile ----------

async function closeShared() {
  const s = g.__ooviShared;
  g.__ooviShared = null;
  for (const [id, x] of sessions) if (x.shared) sessions.delete(id);
  await s?.context.close().catch(() => {});
}

async function sharedContext(cfg: BrowserConfig): Promise<BrowserContext> {
  if (g.__ooviSignIn) throw new Error("The sign-in browser is still open. Close that window when you're done signing in, then try again.");
  const key = `${cfg.channel}|${cfg.allowPrivateNetwork}`;
  if (g.__ooviShared?.key === key) return g.__ooviShared.context;
  await closeShared();
  const context = await launchProfile(cfg.channel, true);
  if (!cfg.allowPrivateNetwork) await blockPrivate(context);
  context.on("close", () => {
    if (g.__ooviShared?.context === context) g.__ooviShared = null;
    for (const [id, s] of sessions) if (s.context === context) sessions.delete(id);
  });
  g.__ooviShared = { context, key };
  return context;
}

// ---------- sessions ----------

export function peekSession(id: string): Session | undefined {
  return sessions.get(id);
}

export async function getSession(id: string, cfg: BrowserConfig, useAccounts = false): Promise<Session> {
  const key = JSON.stringify({ ...cfg, useAccounts });
  let s = sessions.get(id);
  if (s && (s.key !== key || (s.browser && !s.browser.isConnected()))) {
    await closeSession(id);
    s = undefined;
  }
  if (!s) {
    let browser: Browser | undefined;
    let context: BrowserContext;
    if (useAccounts) {
      context = await sharedContext(cfg);
    } else {
      browser = cfg.mode === "docker" ? await chromium.connect(cfg.wsEndpoint, { timeout: 15_000 }) : await launchLocal(cfg.channel);
      context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, locale: "en-US" });
      if (!cfg.allowPrivateNetwork) await blockPrivate(context);
    }
    const page = await context.newPage();
    const sess: Session = { browser, context, page, key, shared: useAccounts, lastUsed: Date.now(), elements: new Map(), downloads: [], pending: [] };
    track(sess, page);
    sessions.set(id, sess);
    s = sess;
  }
  if (s.page.isClosed()) {
    s.page = await s.context.newPage();
    track(s, s.page);
  }
  s.page.setDefaultTimeout(20_000);
  s.lastUsed = Date.now();
  return s;
}

export async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (s.shared) await s.page.close().catch(() => {});
  else await s.browser?.close().catch(() => {});
}

// ---------- signing in to accounts ----------

export type AccountsStatus = { signInOpen: boolean; sites: string[]; updatedAt?: number };

function readAccounts(): { sites: string[]; updatedAt?: number } {
  try {
    const j = JSON.parse(fs.readFileSync(accountsFile(), "utf8")) as { sites?: string[]; updatedAt?: number };
    return { sites: Array.isArray(j.sites) ? j.sites : [], updatedAt: j.updatedAt };
  } catch {
    return { sites: [] };
  }
}

function writeAccounts(a: { sites: string[]; updatedAt?: number }) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(accountsFile(), JSON.stringify(a));
}

export const accountsStatus = (): AccountsStatus => ({ signInOpen: !!g.__ooviSignIn, ...readAccounts() });

const siteOf = (host: string) => host.replace(/^www\./, "").split(".").slice(-2).join(".");

const SITES: [string, string][] = [
  ["X (Twitter)", "https://x.com/login"],
  ["LinkedIn", "https://www.linkedin.com/login"],
  ["Facebook", "https://www.facebook.com/"],
  ["Instagram", "https://www.instagram.com/accounts/login/"],
  ["Reddit", "https://www.reddit.com/login/"],
  ["YouTube", "https://www.youtube.com/"],
  ["GitHub", "https://github.com/login"],
  ["Medium", "https://medium.com/m/signin"],
];

const START_PAGE = `<!doctype html><meta charset="utf-8"><title>Sign in · oovi</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:620px;margin:56px auto;padding:0 24px;color:#171717;background:#fbfaf7">
<h1 style="margin-bottom:4px">Sign in to your accounts</h1>
<p>Use this window like a normal browser. Open a site and sign in <b>yourself</b>. oovi's bots never see your passwords; they only reuse the signed-in session, and they ask you before every click or keystroke.</p>
<ul>${SITES.map(([n, u]) => `<li><a href="${u}">${n}</a></li>`).join("")}</ul>
<p>Any other site works too: type its address in a new tab.</p>
<p><b>When you're done, close this window.</b></p></body>`;

/** Opens a visible browser on the shared profile so the user can sign in to sites. */
export async function openSignInWindow(cfg: BrowserConfig): Promise<void> {
  if (g.__ooviSignIn) return;
  await closeShared();
  const context = await launchProfile(cfg.channel, false);
  g.__ooviSignIn = context;
  const visited = new Set(readAccounts().sites);
  const note = (p: Page) =>
    p.on("framenavigated", (f) => {
      if (f !== p.mainFrame()) return;
      try {
        const u = new URL(f.url());
        if (u.protocol !== "http:" && u.protocol !== "https:") return;
        const site = siteOf(u.hostname);
        if (!visited.has(site)) {
          visited.add(site);
          writeAccounts({ sites: [...visited].sort(), updatedAt: Date.now() });
        }
      } catch {
        /* ignore odd URLs */
      }
    });
  context.pages().forEach(note);
  context.on("page", note);
  context.on("close", () => {
    if (g.__ooviSignIn === context) g.__ooviSignIn = null;
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setContent(START_PAGE).catch(() => {});
}

/** Forget every signed-in session. */
export async function signOutAll(): Promise<void> {
  if (g.__ooviSignIn) {
    await g.__ooviSignIn.close().catch(() => {});
    g.__ooviSignIn = null;
  }
  await closeShared();
  fs.rmSync(profileDir(), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  writeAccounts({ sites: [] });
}
