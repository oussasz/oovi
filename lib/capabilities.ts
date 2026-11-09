// What a bot knows about the user's setup: which connectors, skills and plugins are
// installed, which of them THIS bot can use, and which Marketplace items fit the
// current request. Kept short (names + one line, capped): it goes into every prompt.

import type { CatalogConnector } from "./catalog";
import { catalogCached } from "./catalog-remote";
import { publicServers } from "./mcp";
import { installedPluginsQuick } from "./plugins";
import { listSkills, slugify, tokens } from "./skills";
import type { Bot } from "./types";

const MAX_LIST = 10;
const MAX_SUGGEST = 2;
/** Connectors that reach thousands of apps (Gmail, Drive…) when the app's own connector isn't available. */
const HUBS = ["zapier", "pipedream", "make"];

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const names = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// ---------- matching a request to catalog items ----------

const stem = (w: string) => (w.length > 4 ? w.replace(/ies$/, "y").replace(/s$/, "") : w);

/** Words people use for things the catalog names differently. */
const SYNONYMS: Record<string, string[]> = {
  email: ["gmail", "outlook", "mail", "inbox"],
  mail: ["gmail", "outlook", "email"],
  inbox: ["gmail", "outlook", "email"],
  calendar: ["calendar", "event", "availability"],
  meeting: ["calendar", "meeting", "transcript"],
  schedule: ["calendar", "booking", "availability"],
  agenda: ["calendar"],
  spreadsheet: ["sheet", "airtable"],
  excel: ["sheet"],
  document: ["doc", "docs"],
  todo: ["task", "todoist"],
  crm: ["hubspot", "contact", "deal", "attio"],
  invoice: ["invoice", "payment"],
  repo: ["github", "repository"],
  pull: ["github"],
  slide: ["presentation", "gamma"],
  deck: ["presentation", "gamma"],
  website: ["site", "webflow", "wix"],
  wiki: ["notion", "confluence"],
};

/** Common words in catalog descriptions that say nothing about what a request needs. */
const NOISE = new Set(
  "connect app apps read create update find manage search work file files data tool tools including more your their using through other ready made thousand right like help".split(" ").map(stem),
);

function requestWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(text)) {
    const s = stem(w);
    out.add(s);
    for (const x of SYNONYMS[s] ?? []) out.add(stem(x));
  }
  return out;
}

function score(words: Set<string>, name: string, description: string): number {
  let n = 0;
  for (const w of tokens(name)) if (words.has(stem(w))) n += 3;
  for (const w of tokens(description)) {
    const s = stem(w);
    if (!NOISE.has(s) && words.has(s)) n += 1;
  }
  return n;
}

// ---------- the prompt section ----------

export type CapInput = {
  bot: Bot;
  /** Everyone in this chat (including the bot). */
  members: Bot[];
  allBots: Bot[];
  group: boolean;
  /** The user's current request. */
  request: string;
  /** Connector ids this bot gets for this message only (a /connector command). */
  turnMcp: string[];
};

export function capabilitiesPrompt({ bot, members, allBots, group, request, turnMcp }: CapInput): string {
  const servers = publicServers();
  const { connectors: catalog, skills: catSkills, plugins: catPlugins } = catalogCached();
  const catalogOf = (name: string): CatalogConnector | undefined => catalog.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const mine = new Set([...(bot.tools.mcp ?? []), ...turnMcp]);
  const label = (s: { name: string; auth?: string; signedIn?: boolean }) => {
    const d = catalogOf(s.name)?.description;
    const signIn = s.auth === "oauth" && !s.signedIn ? " [not signed in yet: Marketplace > Connectors > Yours > Connect]" : "";
    return `${d ? `${s.name} (${clip(d)})` : s.name}${signIn}`;
  };
  /** Who else has this connector switched on: teammates in this chat first. */
  const holders = (id: string) => {
    const has = (b: Bot) => b.id !== bot.id && (b.tools.mcp ?? []).includes(id);
    const here = members.filter(has).map((b) => (group ? `@${b.name}` : b.name));
    const elsewhere = group ? allBots.filter((b) => has(b) && !members.some((m) => m.id === b.id)).map((b) => `${b.name} (not in this group)`) : [];
    return [...here, ...elsewhere].slice(0, 3);
  };

  const lines = ["What the user has set up in oovi. Check this list before saying you can't do something; never say you lack access to a connector listed as yours."];

  const usable = servers.filter((s) => s.enabled && mine.has(s.id));
  const notOn = servers.filter((s) => s.enabled && !mine.has(s.id));
  const off = servers.filter((s) => !s.enabled);
  if (!servers.length) lines.push("- Connectors: none installed yet.");
  else {
    lines.push(
      `- Connectors you can use: ${
        usable.length
          ? usable
              .slice(0, MAX_LIST)
              .map((s) => `${label(s)}${turnMcp.includes(s.id) && !(bot.tools.mcp ?? []).includes(s.id) ? " [for this message only]" : ""}`)
              .join("; ")
          : "none"
      }.`,
    );
    if (notOn.length)
      lines.push(
        `- Installed but NOT turned on for you: ${notOn
          .slice(0, MAX_LIST)
          .map((s) => {
            const h = holders(s.id);
            return `${label(s)} [${h.length ? `${names(h)} ${h.length > 1 ? "have" : "has"} it` : "no bot has it on yet"}]`;
          })
          .join("; ")}.`,
      );
    if (off.length) lines.push(`- Installed but switched off for every bot: ${off.slice(0, MAX_LIST).map((s) => s.name).join(", ")} (turn back on in Marketplace > Connectors > Yours > "on").`);
  }
  const teams = installedPluginsQuick()
    .map((p) => catPlugins.find((x) => x.id === p.id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  if (teams.length) lines.push(`- Teams added from Marketplace plugins: ${teams.slice(0, MAX_LIST).map((p) => `${p.name} (group "${p.group}")`).join(", ")}.`);
  if (listSkills().length) lines.push("- Skills: every bot can use the saved skills listed further down.");

  if (notOn.length || off.length) {
    lines.push(
      `If a request needs a connector that isn't on for you, don't try without it: say so plainly (e.g. "Zapier is connected but not turned on for me.") and tell the user how to turn it on: [Open ${bot.name}'s abilities](oovi://bot/${bot.name}) > Tools from MCP servers > tick it > Save, or start the message with /<connector> to lend it to me for one message.${group ? " Or @mention a teammate who has it." : ""}`,
    );
  }

  // Marketplace items that fit this request.
  const words = requestWords(request);
  if (words.size) {
    const have = (name: string) => servers.find((s) => s.name.toLowerCase() === name.toLowerCase());
    const hub = HUBS.map((id) => catalog.find((c) => c.id === id)).find((c) => c && have(c.name)) ?? catalog.find((c) => c.id === "zapier");
    const haveSkills = new Set(listSkills().map((s) => slugify(s.name)));
    const haveTeams = new Set(installedPluginsQuick().map((p) => p.id));
    type Hit = { score: number; line: string; key: string };
    const hits: Hit[] = [];
    for (const c of catalog) {
      const n = score(words, c.name, c.description);
      if (n < 3) continue;
      const installed = have(c.name);
      if (installed) {
        const on = mine.has(installed.id);
        hits.push({ score: n, key: c.id, line: `${c.name} is installed and ${on ? "on for you: use its tools" : "NOT on for you (see above)"}.` });
      } else if (c.soon && hub) {
        const h = have(hub.name);
        hits.push({
          score: n,
          key: hub.id,
          line: h
            ? `${c.name} works through ${hub.name}, which is installed and ${mine.has(h.id) ? "on for you: use its tools" : "NOT on for you (see above)"}.`
            : `${c.name} has no direct connector yet; it works through ${hub.name}: [Connect ${hub.name}](oovi://marketplace/connector/${hub.id}).`,
        });
      } else if (!c.soon) {
        hits.push({ score: n, key: c.id, line: `[Connect ${c.name}](oovi://marketplace/connector/${c.id}): ${clip(c.description)}` });
      }
    }
    for (const s of catSkills) {
      const n = score(words, s.name, s.description);
      if (n >= 3 && !haveSkills.has(slugify(s.name))) hits.push({ score: n, key: `skill:${s.id}`, line: `[Add the ${s.name} skill](oovi://marketplace/skill/${s.id}): ${clip(s.description)}` });
    }
    for (const p of catPlugins) {
      const n = score(words, p.name, p.description);
      if (n >= 3 && !haveTeams.has(p.id)) hits.push({ score: n, key: `plugin:${p.id}`, line: `[Add the ${p.name} team](oovi://marketplace/plugin/${p.id}): ${clip(p.description)}` });
    }
    const seen = new Set<string>();
    const best = hits
      .sort((a, b) => b.score - a.score)
      .filter((h) => !seen.has(h.key) && !!seen.add(h.key))
      .slice(0, MAX_SUGGEST);
    if (best.length) {
      lines.push(
        "Fits this request:",
        ...best.map((h) => `- ${h.line}`),
        "If the request needs something that isn't installed, recommend the best item in one line with its link (it opens in the Marketplace), and carry on once the user has added it.",
      );
    }
  }

  lines.push("Links like [Label](oovi://marketplace/connector/ID), oovi://marketplace/skill/ID, oovi://marketplace/plugin/ID, oovi://settings/TAB or oovi://bot/NAME show as buttons that open that place in the app.");
  return lines.join("\n");
}
