// oovi's Zapier page (components/ZapierApps.tsx): the user's apps in Zapier, without asking a bot.
import { callServerTool, serverTools } from "./mcp";
import { appArgs, appsIn, firstLink, POPULAR, zapierMode, type Schema } from "./zapier-core";

export type ZapierStatus = { mode: "agentic" | "classic" | "none"; ready: string[]; summary: string; manageUrl: string | null };

const cleanText = (t: string) =>
  t
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join("\n")
    .slice(0, 3000);

/** What is on in the user's Zapier: the apps oovi recognizes among the enabled actions. */
export async function zapierStatus(serverId: string): Promise<ZapierStatus> {
  const tools = await serverTools(serverId);
  const names = tools.map((t) => t.name);
  const mode = zapierMode(names);
  if (mode === "classic") {
    // Classic mode: one tool per action the user chose in Zapier ("gmail_send_email"…).
    const cfg = names.includes("get_configuration_url") ? await callServerTool(serverId, "get_configuration_url", {}) : null;
    return { mode, ready: appsIn(names.join(" "), POPULAR), summary: "", manageUrl: cfg ? firstLink(cfg.text) : null };
  }
  if (mode === "none") return { mode, ready: [], summary: "", manageUrl: null };
  const listTool = names.find((n) => n === "inspect_zapier_actions") ?? names.find((n) => n === "list_enabled_zapier_actions");
  const listed = listTool ? await callServerTool(serverId, listTool, {}) : { text: "", isError: false };
  const cfg = names.includes("get_configuration_url") ? await callServerTool(serverId, "get_configuration_url", {}).catch(() => null) : null;
  return { mode, ready: appsIn(listed.text, POPULAR), summary: cleanText(listed.text), manageUrl: cfg ? firstLink(cfg.text) : null };
}

/** The Zapier page where the user connects one app (their own account). */
export async function zapierConnectLink(serverId: string, app: string): Promise<{ url: string } | { error: string }> {
  const tools = await serverTools(serverId);
  const manage = tools.find((t) => t.name === "manage_zapier_connections");
  if (manage) {
    const args = appArgs(manage.inputSchema as Schema | undefined, app);
    if (typeof args === "string") return { error: args };
    const r = await callServerTool(serverId, manage.name, args);
    const url = firstLink(r.text);
    if (url) return { url };
  }
  const cfg = tools.find((t) => t.name === "get_configuration_url");
  if (cfg) {
    const r = await callServerTool(serverId, cfg.name, {});
    const url = firstLink(r.text);
    if (url) return { url };
  }
  return { error: "Zapier didn't give a link. Open zapier.com/mcp and add the app there." };
}

/** Turns on the actions of every app already connected in Zapier (Zapier's auto_provision_mcp). */
export async function zapierProvision(serverId: string): Promise<{ ok: boolean; text: string }> {
  const tools = await serverTools(serverId);
  if (!tools.some((t) => t.name === "auto_provision_mcp")) return { ok: false, text: "This Zapier connection can't do that: choose the apps on Zapier's page instead." };
  const r = await callServerTool(serverId, "auto_provision_mcp", {});
  return { ok: !r.isError, text: cleanText(r.text) };
}

/** Removes one app from what the bots can use (Zapier's disable_zapier_action for the app). The app stays in the user's Zapier. */
export async function zapierRemove(serverId: string, app: string): Promise<{ ok: boolean; text: string }> {
  const tools = await serverTools(serverId);
  const off = tools.find((t) => t.name === "disable_zapier_action");
  if (!off) return { ok: false, text: "This Zapier connection can't do that here: remove the app on Zapier's page (Manage in Zapier)." };
  const args = appArgs(off.inputSchema as Schema | undefined, app);
  if (typeof args === "string") return { ok: false, text: args };
  const r = await callServerTool(serverId, off.name, args);
  return { ok: !r.isError, text: cleanText(r.text) };
}
