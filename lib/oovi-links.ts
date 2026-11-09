// oovi:// links that bots write in chat, e.g. [Connect Zapier](oovi://marketplace/connector/zapier).
// They only ever navigate inside the app: a Marketplace item or tab, a Settings tab,
// or a bot's editor. Anything else is not a link. No Node imports here.

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SETTINGS = ["profile", "models", "telegram", "accounts", "search", "browser", "computer", "safety", "language", "data", "about"];
const MARKET_TABS: Record<string, string> = { connector: "connectors", connectors: "connectors", skill: "skills", skills: "skills", plugin: "plugins", plugins: "plugins", memory: "memory" };

/** Where an oovi:// link goes: an in-app path, or a Settings tab. null = not a valid target. */
export type OoviTarget = { kind: "path"; href: string } | { kind: "settings"; tab?: string };

export function ooviTarget(url: string, bots: { id: string; name: string }[] = []): OoviTarget | null {
  const m = url.match(/^oovi:\/\/([a-z]+)(?:\/([^/?#\s]+))?(?:\/([^/?#\s]+))?\/?$/i);
  if (!m?.[1]) return null;
  const area = m[1].toLowerCase();
  const a = m[2] ? safeDecode(m[2]) : undefined;
  const b = m[3] ? safeDecode(m[3]) : undefined;
  if (a === null || b === null) return null;
  if (area === "marketplace") {
    if (!a) return { kind: "path", href: "/library" };
    const tab = MARKET_TABS[a.toLowerCase()];
    if (!tab) return null;
    if (!b) return { kind: "path", href: `/library?tab=${tab}` };
    if (tab === "memory" || !ID_RE.test(b)) return null;
    return { kind: "path", href: `/library?tab=${tab}&item=${encodeURIComponent(b.toLowerCase())}` };
  }
  if (area === "settings") {
    if (b) return null;
    if (!a) return { kind: "settings" };
    return SETTINGS.includes(a.toLowerCase()) ? { kind: "settings", tab: a.toLowerCase() } : null;
  }
  if (area === "bot" && a && !b) {
    const bot = bots.find((x) => x.name.toLowerCase() === a.toLowerCase());
    return bot ? { kind: "path", href: `/bots/${encodeURIComponent(bot.id)}#abilities` } : null;
  }
  return null;
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
