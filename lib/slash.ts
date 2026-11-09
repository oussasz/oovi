// Slash commands typed at the start of a message: /help, /deep, /effort <level>,
// /<skill> and /<connector>. Shared by the composer (menu, badge) and the server
// (which parses the command when the message is sent). No Node imports here.

export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type SlashKind = "help" | "deep" | "effort" | "skill" | "connector";

/** A command found at the start of a message. `cmd` is what the badge shows. */
export type SlashCommand = { kind: SlashKind; cmd: string; id?: string; name?: string; level?: EffortLevel; installed?: boolean };

/** The /token for a skill or connector name: "Weekly report" → "weekly-report". */
export const slashToken = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export type SlashContext = {
  /** Installed skills (slug = their /token). */
  skills: { slug: string; name: string }[];
  /** Installed connectors (MCP servers). */
  connectors: { id: string; name: string }[];
  /** Catalog connectors that aren't installed (recognised so the bot can suggest adding them). */
  catalog?: { id: string; name: string }[];
};

const HEAD = /^\/([a-z0-9][a-z0-9._-]{0,63})(?=\s|$)/i;

/**
 * The command at the start of `text`, and the rest of the message.
 * Unknown commands return null, so "/something" stays plain text.
 */
export function parseSlash(text: string, ctx: SlashContext): { command: SlashCommand; rest: string } | null {
  const t = text.trimStart();
  const m = t.match(HEAD);
  if (!m?.[1]) return null;
  const tok = m[1].toLowerCase();
  let rest = t.slice(m[0].length).trim();
  if (tok === "help") return { command: { kind: "help", cmd: "/help" }, rest };
  if (tok === "deep") return { command: { kind: "deep", cmd: "/deep" }, rest };
  if (tok === "effort") {
    const lv = rest.match(/^(\S+)/)?.[1]?.toLowerCase();
    if (!lv || !(EFFORT_LEVELS as readonly string[]).includes(lv)) return null;
    rest = rest.slice(lv.length).trim();
    return { command: { kind: "effort", cmd: `/effort ${lv}`, level: lv as EffortLevel }, rest };
  }
  const conn = ctx.connectors.find((c) => c.id.toLowerCase() === tok || slashToken(c.name) === tok);
  if (conn) return { command: { kind: "connector", cmd: `/${tok}`, id: conn.id, name: conn.name, installed: true }, rest };
  const skill = ctx.skills.find((s) => s.slug === tok || slashToken(s.name) === tok);
  if (skill) return { command: { kind: "skill", cmd: `/${tok}`, id: skill.slug, name: skill.name }, rest };
  const cat = ctx.catalog?.find((c) => c.id.toLowerCase() === tok || slashToken(c.name) === tok);
  if (cat) return { command: { kind: "connector", cmd: `/${tok}`, id: cat.id, name: cat.name, installed: false }, rest };
  return null;
}
