// Which bots can use a connector. A connector's tools only reach the bots that have it
// in their abilities (bot.tools.mcp), so a new connector is turned on for the main bot
// (the Chief) right away: it works as soon as the user asks.

import { listBots, updateBot } from "./store";
import { mainBot } from "./team";

/** Ids of the bots that have this connector on. */
export function connectorBots(serverId: string): string[] {
  return listBots()
    .filter((b) => (b.tools.mcp ?? []).includes(serverId))
    .map((b) => b.id);
}

/** Turn a connector on for exactly these bots (and off for every other bot). */
export function setConnectorBots(serverId: string, botIds: string[]): string[] {
  const want = new Set(botIds);
  for (const b of listBots()) {
    const cur = b.tools.mcp ?? [];
    const has = cur.includes(serverId);
    if (has === want.has(b.id)) continue;
    const mcp = has ? cur.filter((x) => x !== serverId) : [...cur, serverId].slice(-20);
    const { id, createdAt: _c, ...input } = b;
    updateBot(id, { ...input, tools: { ...b.tools, mcp } });
  }
  return connectorBots(serverId);
}

/** A connector was just added: turn it on for the main bot. Returns that bot's name. */
export function turnOnForMain(serverId: string): string | undefined {
  const main = mainBot();
  if (!main) return undefined;
  if (!(main.tools.mcp ?? []).includes(serverId)) setConnectorBots(serverId, [...connectorBots(serverId), main.id]);
  return main.name;
}
