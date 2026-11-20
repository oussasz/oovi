// oovi's Zapier page ("Your apps", lib/zapier.ts) against a stand-in Zapier connector with Zapier's tool
// names: which apps are ready, the link to connect one app, "use all my Zapier apps", and what a bot is told
// when a Zapier action fails with no reason. Run: node tests/e2e/zapier-scenario.cjs (SHOT=dir for screenshots)
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-zapier-test");
const PORT = 3329;
const MODEL_PORT = 3388;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-zapier-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: {} };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 40 }, oovi: live() });
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
const MCP_PORT = 3387;
const seen = { bodies: [] };
const lastTool = (msgs) => {
  const prev = msgs[msgs.length - 2];
  return prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
};
async function answer(body) {
  seen.bodies.push(body);
  const msgs = body.messages || [];
  const tools = (body.tools || []).map((t) => t.name);
  const read = tools.find((t) => /execute_zapier_read_action$/.test(t));
  // Zapier down (check G): the model still reaches for the tool it remembers.
  if (seen.down && !seen.downUser) seen.downUser = JSON.stringify(msgs.at(-1) || {});
  if (seen.down) seen.downSystem = typeof body.system === "string" ? body.system : (body.system || []).map((x) => x.text || "").join("");
  if (!lastTool(msgs)) return reply([{ type: "tool_use", id: `toolu_${Date.now()}`, name: read || seen.remembered, input: { app: "gmail", action: "find_email", instructions: "latest invoice" } }], "tool_use");
  const last = msgs.at(-1);
  seen.result = (last.content || []).filter((x) => x.type === "tool_result").map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n");
  return reply([{ type: "text", text: "READ-DONE" }], "end_turn");
}

(async () => {
  const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { z } = require("zod");
  http
    .createServer(async (req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        if (seen.down) {
          res.writeHead(503, { "content-type": "text/plain" });
          return res.end("Service Unavailable");
        }
        const server = new McpServer({ name: "zapier", version: "1.0.0" });
        server.registerTool("inspect_zapier_actions", { description: "List enabled actions" }, async () => ({ content: [{ type: "text", text: (seen.provisioned ? "Enabled actions:\\n- gmail_find_email (Gmail)\\n- GoogleCalendarCLIAPI find_event (Google Calendar)\\n- slack_send_channel_message (Slack)" : "Enabled actions:\\n- gmail_find_email (Gmail)").split("\\n").filter((l) => !(seen.removed || []).some((a) => l.includes(`(${a})`))).join("\\n") }] }));
        server.registerTool("disable_zapier_action", { description: "Disable an app's actions", inputSchema: { app: z.string(), action: z.string().optional() } }, async (a) => {
          seen.removed = [...(seen.removed || []), a.app];
          return { content: [{ type: "text", text: `Disabled ${a.app}.` }] };
        });
        server.registerTool("manage_zapier_connections", { description: "Add a connection", inputSchema: { app: z.string(), action: z.enum(["set_default", "add_connection"]) } }, async (a) => {
          seen.manage = a;
          return { content: [{ type: "text", text: `Open https://mcp.zapier.com/mcp/servers/x/connections?app=${encodeURIComponent(a.app)} to connect.` }] };
        });
        server.registerTool("auto_provision_mcp", { description: "Provision" }, async () => {
          seen.provisioned = true;
          return { content: [{ type: "text", text: "Provisioned 3 apps." }] };
        });
        server.registerTool("get_configuration_url", { description: "Config" }, async () => ({ content: [{ type: "text", text: "https://mcp.zapier.com/mcp/servers/x/config" }] }));
        server.registerTool("execute_zapier_read_action", { description: "Run a read action", inputSchema: { app: z.string(), action: z.string(), instructions: z.string() } }, async () => ({ content: [], isError: true }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      });
    })
    .listen(MCP_PORT, "127.0.0.1");
})();

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      const url = req.url.split("?")[0];
      if (url === "/api/v1/ai/status") return send(200, status);
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Marys", image: null } });
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      const rules = require("./model-rules.cjs");
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        const b = JSON.parse(raw);
        const refused = rules.refusal(b);
        if (refused) {
          seen.refused = refused;
          return send(400, { error: refused });
        }
        if (rules.isDoneCheck(b)) return send(200, rules.doneReply(b));
        const sysText = typeof b.system === "string" ? b.system : (b.system || []).map((x) => x.text || "").join("");
        if (/You keep the running memory of a conversation/.test(sysText)) return send(200, reply([{ type: "text", text: "SUMMARY" }], "end_turn"));
        return send(200, await answer(b));
      }
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

let server = null;
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, j };
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: `http://127.0.0.1:${MODEL_PORT}`, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => fs.appendFileSync(LOG, `   [server] ${d}`));
  server.stderr.on("data", (d) => fs.appendFileSync(LOG, `   [server!] ${d}`));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/bots`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const bots = (await api("GET", "/api/bots")).j;
  const chief = (await api("GET", "/api/main")).j;
  const dm = `dm-${chief.botId}`;
  const idle = async (chat = dm) => {
    for (let i = 0; i < 400; i++) {
      const c = (await api("GET", `/api/chats/${chat}`)).j;
      if (!c.running) return c;
      await sleep(250);
    }
    throw new Error("the run didn't end");
  };

  const run = async (chat, body) => {
    const r = await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await r.text();
    return idle(chat);
  };
  const add = await api("POST", "/api/mcp", { name: "Zapier", transport: "http", url: `http://127.0.0.1:${MCP_PORT}/mcp` });
  const id = add.j.id;
  check("Zapier stand-in added", add.status === 201, JSON.stringify(add.j));
  let st = (await api("GET", `/api/mcp/${id}/zapier`)).j;
  check("A) the apps that are ready are listed (from Zapier's enabled actions)", st.mode === "agentic" && JSON.stringify(st.ready) === '["Gmail"]' && st.manageUrl === "https://mcp.zapier.com/mcp/servers/x/config", JSON.stringify(st));
  const con = await api("POST", `/api/mcp/${id}/zapier`, { op: "connect", app: "Google Calendar" });
  check("B) one app: Zapier's own page to connect it, with the app filled in", con.status === 200 && /connections\?app=Google%20Calendar$/.test(con.j.url) && seen.manage?.action === "add_connection", JSON.stringify(con.j));
  const pr = await api("POST", `/api/mcp/${id}/zapier`, { op: "provision" });
  st = (await api("GET", `/api/mcp/${id}/zapier`)).j;
  check("C) Use all my Zapier apps turns them on, and they show as ready", pr.j.ok === true && JSON.stringify(st.ready) === '["Gmail","Google Calendar","Slack"]', JSON.stringify(st.ready));
  const rm = await api("POST", `/api/mcp/${id}/zapier`, { op: "remove", app: "Slack" });
  const st2 = (await api("GET", `/api/mcp/${id}/zapier`)).j;
  check("E) one app can be removed, and it no longer shows as ready", rm.j.ok === true && JSON.stringify(st2.ready) === '["Gmail","Google Calendar"]' && JSON.stringify(seen.removed) === '["Slack"]', JSON.stringify(st2.ready));
  // An AI key is checked before it is called connected: a refused key is refused, and nothing is saved.
  const keySrv = http.createServer((req, res) => {
    res.writeHead(req.headers.authorization === "Bearer good-key" ? 200 : 401, { "content-type": "application/json" });
    res.end('{"data":[]}');
  });
  await new Promise((r) => keySrv.listen(3343, "127.0.0.1", r));
  const bad = await api("POST", "/api/settings/check", { provider: "custom", apiKey: "wrong-key", baseUrl: "http://127.0.0.1:3343/v1" });
  const good = await api("POST", "/api/settings/check", { provider: "custom", apiKey: "good-key", baseUrl: "http://127.0.0.1:3343/v1" });
  const down = await api("POST", "/api/settings/check", { provider: "custom", baseUrl: "http://127.0.0.1:1/v1" });
  check("F) an AI key the provider refuses is not called connected", bad.j.ok === false && /refused this key/.test(bad.j.error) && good.j.ok === true && down.j.ok === false && /Couldn't reach/.test(down.j.error), JSON.stringify([bad.j, good.j, down.j]));
  keySrv.close();
  if (process.env.SHOT) {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
    await p.goto(`${BASE}/library?tab=connectors&item=zapier`);
    await p.waitForSelector(".zap-apps", { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const el = (await p.locator(".cs-card").count()) ? p.locator(".cs-card").first() : p.locator("body");
    await el.screenshot({ path: `${process.env.SHOT}/zapier-apps.png` });
    await b.close();
  }
  await run(dm, { text: "find my latest invoice in gmail" });
  check("D) a Zapier action failing with no reason: the bot is told what usually causes it and what to do", /Zapier gave no reason\. Next step:/.test(seen.result || "") && /Your apps/.test(seen.result || ""), (seen.result || "").slice(0, 300));
  const helpText = JSON.stringify(seen.bodies.at(-1)?.tools || []);
  check("D) the bot is not told to paste Zapier links", /Don't paste Zapier links/.test(seen.result || "") && /connect_app/.test(seen.result || ""));
  // G) Zapier stops answering (owner, 2026-11-19: "isn't enabled for Oovi" though it was connected): the bot is told
  // the real reason, never "not enabled", and not to call it again; its call gets the same reason back.
  seen.remembered = `mcp_${id.replace(/-/g, "_")}_execute_zapier_read_action`;
  seen.down = true;
  seen.result = "";
  await api("POST", `/api/mcp/${id}`); // the Test button: drops the connection, so the next turn connects again
  await run(dm, { text: "find my latest invoice in gmail again" });
  check("G) Zapier down: the bot's instructions say it couldn't be reached and why, not 'not enabled'", /Zapier couldn't be reached just now \(/.test(seen.downSystem || "") && /don't call them/.test(seen.downSystem || ""), (seen.downSystem || "").match(/Zapier couldn.{0,200}/)?.[0] || "no line");
  check("G) ... and a call it makes anyway gets the reason back, with the button to open Zapier", /^Not run\. Zapier couldn't be reached just now/.test(seen.result || "") && !/isn't enabled/.test(seen.result || "") && /oovi:\/\/marketplace\/connector\//.test(seen.result || ""), (seen.result || "").slice(0, 300));
  check("G) ... no OK card for a call that can't run, and the note on the message doesn't say 'use its tools'", !/use its tools/.test(seen.downUser || "") && /didn't answer just now/.test(seen.downUser || ""), (seen.downUser || "").match(/Gmail works[^\]]{0,120}/)?.[0] || "");
  seen.down = false;

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
