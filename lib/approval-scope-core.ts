// Fewer approval cards, same safety. An OK can now cover more than one action:
// - "Allow for this chat": the same kind of action again in this conversation (the bots' browser on the same
//   site, or the same connector action) no longer asks;
// - "Always on <site>": clicks and typing on that site never ask again (Settings > Safety lists the sites).
// What can never be allowed ahead: signing in with a saved password, sending a file from the computer, using
// the computer's mouse and keyboard (asked per task already), deleting through a connector, saving skills and
// routines. A connector action that sends, posts or pays and runs without a fresh card waits a few seconds
// first, with Cancel. Pure: tests/unit/approval-scope.test.mts.

export type Scope = { key: string; kind: "site" | "tool"; label: string };

/** Browser actions an OK for a site can cover (never uploads: those send a file from the computer). */
const SITE_TOOLS = new Set(["click", "type", "browser_steps", "download_file"]);

/** The host of a web page, lower-case, without "www."; null for anything that isn't an http(s) page. */
export function hostOf(url: string | undefined | null): string | null {
  try {
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The scope one approval of this call can cover, or null when it must be asked every time. */
export function scopeOf(tool: string, pageUrl?: string | null, hints?: { destructive?: boolean }): Scope | null {
  if (SITE_TOOLS.has(tool)) {
    const host = hostOf(pageUrl);
    return host ? { key: `site:${host}`, kind: "site", label: host } : null;
  }
  if (tool.startsWith("mcp_")) {
    if (hints?.destructive || /delete|remove|destroy|erase|purge|drop|trash|archive|cancel/i.test(tool)) return null;
    return { key: `tool:${tool}`, kind: "tool", label: tool.replace(/^mcp_/, "").replace(/[_-]+/g, " ") };
  }
  return null;
}

/** A site the user always allows covers its sub-sites too (allowing "example.com" covers "shop.example.com"). */
export function siteAllowed(host: string, sites: readonly string[] | undefined): boolean {
  return (sites ?? []).some((s) => host === s || host.endsWith(`.${s}`));
}

/** Already allowed: for this chat, or (sites) always. */
export function granted(scope: Scope | null, chatAllow: readonly string[] | undefined, sites: readonly string[] | undefined): boolean {
  if (!scope) return false;
  if ((chatAllow ?? []).includes(scope.key)) return true;
  return scope.kind === "site" && siteAllowed(scope.label, sites);
}

/** Connector actions that reach other people (send, post, reply, pay…): they wait a moment, with Cancel, when no card was shown for them. */
const SENDS = new Set("send sends post publish reply message tweet comment share invite submit order pay transfer book forward dm".split(" "));
const READS = new Set("search list get read find fetch query lookup count".split(" "));
export function reachesOthers(tool: string): boolean {
  if (!tool.startsWith("mcp_")) return false;
  const words = tool.slice(4).split(/[_\-.\s]+|(?=[A-Z])/).map((w) => w.toLowerCase());
  return words.some((w) => SENDS.has(w)) && !words.some((w) => READS.has(w));
}

export const HOLD_MS = 8_000;

/** Adds keys to a chat's allow list (no duplicates, the 100 latest). */
export function addGrants(list: readonly string[] | undefined, keys: readonly string[]): string[] {
  const out = [...(list ?? [])];
  for (const k of keys) if (k && !out.includes(k)) out.push(k);
  return out.slice(-100);
}

/** A site the user typed or that a card named: a clean host, or null. */
export function cleanSite(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  return hostOf(/^https?:\/\//.test(s) ? s : `https://${s}`);
}
