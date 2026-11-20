// connect_app: when an app's account isn't connected yet (Gmail in Zapier…), the bot asks oovi to get it
// connected. The user gets one card; the connection page opens in their own browser; oovi waits until the
// service says the account is there, and the bot goes on in the same turn. Before, the bot pasted a link in
// the chat and guessed: after "connected" it sent the link again (the 2026-11-20 conversation).
import { waitForChange } from "./connect-core";
import { openUserBrowser } from "./desktop-control";
import type { ToolSpec } from "./llm";
import { callServerTool, getServer, serverTools } from "./mcp";
import type { ApprovalItem, ToolCall, ToolResult } from "./types";
import { zapierConnectLink } from "./zapier";
import { appArgs, type Schema } from "./zapier-core";

export const CONNECT_APP = "connect_app";

export const CONNECT_SPEC: ToolSpec = {
  name: CONNECT_APP,
  description:
    "Get one of the user's apps connected (Gmail, Google Calendar, Slack, Notion…) when a task needs it and its account isn't connected yet. oovi shows the user one card; the connection page opens in their own browser; oovi then waits and tells you the moment the account is connected, so you go on with the task in the same turn. Use it whenever an app turns out not to be connected. Don't paste a connection link in the chat, don't open that page in your own browser, and don't ask the user to tell you when it's done.",
  parameters: {
    type: "object",
    properties: { app: { type: "string", description: "The app's name, e.g. 'Gmail'" } },
    required: ["app"],
  },
};

/** The bot's Zapier connector (the one that connects apps), if it has one switched on. */
export function zapierAmong(ids: string[]): string | null {
  return ids.find((id) => ((s) => !!s && s.enabled && /zapier/i.test(`${s.name} ${s.url ?? ""}`))(getServer(id))) ?? null;
}

const appOf = (call: ToolCall) => String(call.input.app ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

type Tr = (key: "connect.card" | "st.connectWait", vars?: Record<string, string | number>) => string;

export function connectItem(call: ToolCall, tr: Tr): ApprovalItem {
  return { call, summary: tr("connect.card", { app: appOf(call) || "?" }) };
}

/** What the service says about this app's connections right now (any text: only a change matters). */
async function connectionState(serverId: string, app: string): Promise<string | null> {
  try {
    const tools = await serverTools(serverId);
    const list = tools.find((t) => t.name === "list_zapier_connections");
    if (list) {
      const args = appArgs(list.inputSchema as Schema | undefined, app);
      if (typeof args !== "string") {
        const r = await callServerTool(serverId, list.name, args);
        if (!r.isError) return r.text;
      }
    }
    const inspect = tools.find((t) => t.name === "inspect_zapier_actions");
    if (!inspect) return null;
    const r = await callServerTool(serverId, inspect.name, {});
    return r.isError ? null : r.text;
  } catch {
    return null;
  }
}

const WAIT_MS = 5 * 60_000;
const EVERY_MS = 3000;

export async function runConnectApp(call: ToolCall, o: { serverIds: string[]; signal: AbortSignal; wait: boolean; everyMs?: number; maxMs?: number }): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const app = appOf(call);
  if (!app) return fail("app is required: the name of the app to connect, e.g. 'Gmail'.");
  const sid = zapierAmong(o.serverIds);
  if (!sid) return fail(`You have no connector that can connect ${app}. Say so in one line and point to [the Marketplace](oovi://marketplace).`);
  const link = await zapierConnectLink(sid, app).catch((e: Error) => ({ error: e.message || String(e) }));
  if ("error" in link) return fail(`The page to connect ${app} couldn't be found: ${link.error}`);
  const before = (await connectionState(sid, app)) ?? "";
  const opened = await openUserBrowser(link.url);
  const button = `[Connect ${app}](${link.url})`;
  // Nobody is at the app (Telegram, a routine): the user gets the button and writes again when it is done.
  if (!o.wait) return { id: call.id, name: call.name, content: `Give the user this button, in one line: ${button}. When they write again, the state of their apps is checked for you.` };
  const r = await waitForChange(() => connectionState(sid, app), { before, everyMs: o.everyMs ?? EVERY_MS, maxMs: o.maxMs ?? WAIT_MS, sleep: (ms) => new Promise((x) => setTimeout(x, ms)), now: Date.now, signal: o.signal });
  if (r.changed) return { id: call.id, name: call.name, content: `${app} is connected now (the service confirms it). Go on with the task: do what you were about to do with ${app}.` };
  if (r.reason === "stopped") return fail("Stopped by the user.");
  return fail(`${app} was not connected within ${Math.round((o.maxMs ?? WAIT_MS) / 60_000)} minutes${opened ? "" : " (the page couldn't be opened in the user's browser from here)"}. Say so in one line with this button: ${button}. When they write again, the state of their apps is checked for you.`);
}
