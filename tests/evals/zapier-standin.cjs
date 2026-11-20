// A stand-in for Zapier's MCP server (agentic mode: 17 meta-tools, the real names and the descriptions the
// installed app saved). Nothing leaves this computer: a "sent" email is one line in sent.jsonl.
// State: LAB_OUT/zapier-state.json {enabled: bool (Gmail actions enabled), connected: bool (Gmail account connected)}.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "../..");
const { McpServer } = require(path.join(ROOT, "node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js"));
const { StreamableHTTPServerTransport } = require(path.join(ROOT, "node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js"));
const { z } = require(path.join(ROOT, "node_modules/zod"));
const OUT = process.env.LAB_OUT;
const PORT = Number(process.env.ZAP_PORT) || 4702;
const stateFile = path.join(OUT, "zapier-state.json");
const state = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return { enabled: true, connected: true }; } };
const save = (s) => fs.writeFileSync(stateFile, JSON.stringify(s));
const logCall = (name, args, result) => fs.appendFileSync(path.join(OUT, "zapier-calls.jsonl"), JSON.stringify({ at: new Date().toISOString(), name, args, result: String(result).slice(0, 300) }) + "\n");
let DESC = {};
try { DESC = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, "zapier-tools.json"), "utf8")).map((t) => [t.name, t.description])); } catch {}
const GMAIL = "GoogleMailV2CLIAPI";
const CONNECT_URL = "https://mcp.zapier.com/mcp/servers/standin/connections?app=gmail";
const ACTIONS = `Enabled actions for Gmail (selected_api: ${GMAIL}):
WRITE (execute_zapier_write_action):
- action "send_email": Send Email. params: to (string, required; one address or several separated by commas), subject (string, required), body (string, required), body_type ("plain"|"html"), cc (string), bcc (string), from_name (string)
- action "draft": Create Draft. params: to, subject, body, body_type, cc, bcc
READ (execute_zapier_read_action):
- action "message": Find Email. params: query (Gmail search string, required)`;
const text = (t, isError) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
function build() {
  const server = new McpServer({ name: "zapier", version: "1.0.0" });
  const reg = (name, schema, fn) => server.registerTool(name, { description: DESC[name] || name, inputSchema: schema }, async (a) => { const r = await fn(a || {}); logCall(name, a, r.content[0].text); return r; });
  const api = { selected_api: z.string().describe("The app's selected_api id, e.g. GoogleMailV2CLIAPI").optional() };
  reg("discover_zapier_actions", { query: z.string().describe("App or action to look for, e.g. 'gmail send email'") }, async () => text(`Found 1 app:\n- app: Gmail, selected_api: ${GMAIL}. Actions: send_email (write), draft (write), message (read). ${state().enabled ? "Already enabled on this server." : "Not enabled yet: call enable_zapier_action."}`));
  reg("enable_zapier_action", { selected_api: z.string(), app_display_name: z.string().optional(), actions: z.array(z.string()).optional() }, async () => { save({ ...state(), enabled: true }); return text(`Enabled Gmail actions (send_email, draft, message).${state().connected ? "" : ` Gmail has no connected account yet: the user must connect one at ${CONNECT_URL}`}`); });
  reg("disable_zapier_action", { selected_api: z.string(), app_display_name: z.string().optional() }, async () => { save({ ...state(), enabled: false }); return text("Disabled."); });
  reg("inspect_zapier_actions", { ...api }, async () => text(state().enabled ? `${ACTIONS}\nConnection: ${state().connected ? "default connection set (id: conn_1, account: the user's Gmail)" : `NO connected account. The user must connect Gmail first: ${CONNECT_URL}`}` : "No actions are enabled on this server. Use discover_zapier_actions then enable_zapier_action."));
  reg("execute_zapier_read_action", { selected_api: z.string(), action: z.string(), params: z.record(z.any()).optional(), instructions: z.string().optional(), output: z.string().optional(), connection_id: z.string().optional() }, async () => text(state().connected ? "[]  (no matching emails)" : `Gmail is not connected. ${CONNECT_URL}`, !state().connected));
  reg("execute_zapier_write_action", { selected_api: z.string(), action: z.string(), params: z.record(z.any()).describe("The action's parameters, as inspect_zapier_actions lists them"), instructions: z.string().optional(), output: z.string().optional(), connection_id: z.string().optional() }, async (a) => {
    const s = state();
    if (!s.enabled) return text("Action not enabled on this server. Use discover_zapier_actions then enable_zapier_action.", true);
    if (!s.connected) return text(`No default connection for Gmail. The user must connect an account: ${CONNECT_URL}`, true);
    const p = a.params || {};
    if (!/^(send_email|draft)$/.test(a.action)) return text(`Unknown action "${a.action}". Use inspect_zapier_actions for the exact action keys.`, true);
    for (const k of ["to", "subject", "body"]) if (!p[k]) return text(`Missing argument values for required properties: ${k}`, true);
    const to = String(p.to).split(/[,;]\s*/).filter(Boolean);
    fs.appendFileSync(path.join(OUT, "sent.jsonl"), JSON.stringify({ at: new Date().toISOString(), action: a.action, to, subject: p.subject, body: p.body }) + "\n");
    return text(JSON.stringify({ status: a.action === "draft" ? "draft_created" : "sent", id: `msg_${Date.now()}`, to }));
  });
  reg("list_zapier_connections", { selected_api: z.string() }, async () => text(state().connected ? JSON.stringify([{ id: "conn_1", app: "Gmail", title: "Gmail (the user's account)", is_default: true }]) : "[]  (no connections for this app)"));
  reg("manage_zapier_connections", { selected_api: z.string(), action: z.enum(["add_connection", "set_default"]).optional(), connection_id: z.string().optional() }, async () => text(`Open this page to connect a Gmail account: ${CONNECT_URL}`));
  reg("send_feedback", { feedback: z.string() }, async () => text("Thanks."));
  reg("auto_provision_mcp", {}, async () => { save({ ...state(), enabled: true }); return text(`Provisioned 1 app: Gmail${state().connected ? "" : " (no connected account)"}.`); });
  reg("list_zapier_skills", {}, async () => text("[]"));
  reg("get_zapier_skill", { uri: z.string() }, async () => text("Not found.", true));
  reg("create_zapier_skill", { name: z.string(), content: z.string() }, async () => text("Created."));
  reg("update_zapier_skill", { uri: z.string(), content: z.string() }, async () => text("Updated."));
  reg("delete_zapier_skill", { uri: z.string() }, async () => text("Deleted."));
  reg("write_code_action", { code: z.string(), instructions: z.string().optional() }, async () => text("Code actions are not available on this server.", true));
  reg("get_configuration_url", {}, async () => text("https://mcp.zapier.com/mcp/servers/standin/config"));
  return server;
}
http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    if (req.url.startsWith("/state")) { const q = new URL(req.url, "http://x").searchParams; if (q.has("connected") || q.has("enabled")) save({ ...state(), ...(q.has("connected") ? { connected: q.get("connected") === "1" } : {}), ...(q.has("enabled") ? { enabled: q.get("enabled") === "1" } : {}) }); res.writeHead(200); return res.end(JSON.stringify(state())); }
    try {
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    } catch (e) { if (!res.headersSent) { res.writeHead(500); res.end(String(e.message)); } }
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[zapier stand-in] ${PORT}`));
