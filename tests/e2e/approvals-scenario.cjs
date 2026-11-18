// Fewer approval cards (lib/approval-scope-core.ts) with a real connector (a small MCP server run here):
// sending asks first; "Allow for this chat" covers that action in that chat; a send allowed that way waits
// 8 seconds with Cancel, and Cancel stops it (nothing sent); deleting always asks, even after "allow";
// reading never asks. Scripted model, nothing leaves this machine. Run: node tests/e2e/approvals-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-approvals-test");
const PORT = 3327;
const MODEL_PORT = 3392;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-approvals-log.txt");
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
const MCP_PORT = 3341;
const seen = { bodies: [], sent: [], deleted: [] };
const lastTool = (msgs) => {
  const prev = msgs[msgs.length - 2];
  return prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
};
async function answer(body) {
  seen.bodies.push(body);
  const msgs = body.messages || [];
  const cur = msgs.filter((m) => m.role === "user" && textOf(m).trim()).map(textOf).at(-1) || "";
  const tools = (body.tools || []).map((t) => t.name);
  seen.tools = tools;
  const send = tools.find((t) => /send_email$/.test(t));
  const del = tools.find((t) => /delete_email$/.test(t));
  const search = tools.find((t) => /search_email$/.test(t));
  const lt = lastTool(msgs);
  const tool = (name, input) => reply([{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }], "tool_use");
  if (/SEND-(\w+)/.test(cur)) {
    const tag = /SEND-(\w+)/.exec(cur)[1];
    if (!lt || lt === "use_tool") return tool(send, { to: "karim@example.test", subject: tag });
    return reply([{ type: "text", text: `DONE-${tag}` }], "end_turn");
  }
  if (/DELETE-(\w+)/.test(cur)) {
    if (!lt) return tool(del, { id: /DELETE-(\w+)/.exec(cur)[1] });
    return reply([{ type: "text", text: "DONE-DELETE" }], "end_turn");
  }
  if (/SEARCH/.test(cur)) {
    if (!lt) return tool(search, { q: "invoice" });
    return reply([{ type: "text", text: "DONE-SEARCH" }], "end_turn");
  }
  return reply([{ type: "text", text: "ok" }], "end_turn");
}

// A small connector: send_email, delete_email (marked destructive), search_email (read-only).
(async () => {
  const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
  const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const { z } = require("zod");
  http
    .createServer(async (req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const server = new McpServer({ name: "mail-test", version: "1.0.0" });
        server.registerTool("send_email", { description: "Send an email", inputSchema: { to: z.string(), subject: z.string() } }, async (a) => {
          seen.sent.push(a.subject);
          return { content: [{ type: "text", text: `sent ${a.subject}` }] };
        });
        server.registerTool("delete_email", { description: "Delete an email", inputSchema: { id: z.string() }, annotations: { destructiveHint: true } }, async (a) => {
          seen.deleted.push(a.id);
          return { content: [{ type: "text", text: `deleted ${a.id}` }] };
        });
        server.registerTool("search_email", { description: "Search emails", inputSchema: { q: z.string() }, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "2 emails" }] }));
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
  const add = await api("POST", "/api/mcp", { name: "Mail test", transport: "http", url: `http://127.0.0.1:${MCP_PORT}/mcp` });
  check("connector added for the Chief", add.status === 201, JSON.stringify(add.j));
  await sleep(1500);

  let c = await run(dm, { text: "SEND-one" });
  let card = c.pending?.approval;
  check("A) sending asks first, and offers to allow it for this chat", !!card && card.items[0].scope?.kind === "tool" && card.items[0].scope.key === "tool:mcp_mail_test_send_email", JSON.stringify(card?.items?.[0]?.scope));
  check("A) the card says it in plain words, the tool's name and raw data only under Details", card.items[0].summary === "Send an email in Mail test\nTo: karim@example.test\nSubject: one" && /mcp_mail_test_send_email/.test(card.items[0].detail || "") && !/mcp_|\{/.test(card.items[0].summary), JSON.stringify(card.items[0]));
  check("A) the allow button names the action in plain words", card.items[0].scope.label === "Send an email in Mail test", card.items[0].scope.label);
  if (process.env.SHOT) {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
    await p.goto(`${BASE}/c/${dm}`);
    await p.waitForSelector(".approval");
    await p.locator(".approval").screenshot({ path: `${process.env.SHOT}/card-en.png` });
    await p.locator(".approval summary").click();
    await p.locator(".approval").screenshot({ path: `${process.env.SHOT}/card-en-details.png` });
    await b.close();
  }
  c = await run(dm, { decisions: Object.fromEntries(card.items.map((i) => [i.call.id, true])), allowChat: true });
  check("A) approved: sent at once, no wait (the card was the check)", seen.sent.includes("one") && /DONE-one/.test(c.entries.at(-1).text || ""));

  const t0 = Date.now();
  c = await run(dm, { text: "SEND-two" });
  check("B) the next send in this chat has no card", !c.pending?.approval);
  check("B) but it waited about 8 seconds before going (time to cancel)", seen.sent.includes("two") && Date.now() - t0 >= 7500, `${Date.now() - t0} ms`);

  // C: cancel during the wait: nothing is sent.
  // Read the run's live events like the chat screen does, and press Cancel when the wait shows.
  const res = await fetch(`${BASE}/api/chats/${dm}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "SEND-three" }) });
  const reader = res.body.getReader();
  let r3 = "";
  let cancel = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    r3 += Buffer.from(value).toString();
    const m = /"type":"hold","hold":\{[^}]*"callId":"([^"]+)"/.exec(r3);
    if (m && !cancel) {
      await sleep(800);
      cancel = await api("POST", `/api/chats/${dm}/hold`, { callId: m[1] });
    }
  }
  cancel = cancel || { status: 0 };
  c = await idle(dm);
  check("C) Cancel during the wait stops the send: nothing sent", cancel.status === 200 && !seen.sent.includes("three"), `${cancel.status} ${JSON.stringify(seen.sent)}`);
  check("C) the bot is told it was cancelled", c.entries.at(-1).steps.some((m) => m.role === "tool" && m.results.some((x) => /cancelled this at the last moment/.test(x.content))));
  check("C) the chat saw the wait (with what is being sent)", /"type":"hold"/.test(r3) && /"until"/.test(r3));
  check("C) an old Cancel can't stop anything else", (await api("POST", `/api/chats/${dm}/hold`, { callId: "nope" })).status === 409);

  // The card follows the user's language.
  // (In a copy of the chat made before "allow": sending still asks there.)
  const firstUser = (await api("GET", `/api/chats/${dm}`)).j.entries.find((e) => e.kind === "user");
  const fork = (await api("POST", `/api/chats/${dm}/fork`, { entryId: firstUser.id })).j.id;
  c = await run(fork, { text: "SEND-ar أرسل البريد إلى كريم من فضلك" });
  const arCard = c.pending?.approval;
  check("A) in Arabic when the user writes Arabic", !!arCard && /^إرسال بريد إلكتروني في Mail test\nإلى: karim@example\.test/.test(arCard.items[0].summary), arCard?.items?.[0]?.summary);
  if (process.env.SHOT && arCard) {
    const { chromium } = require("playwright");
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
    await p.goto(`${BASE}/c/${fork}`);
    await p.waitForSelector(".approval");
    await p.locator(".approval").screenshot({ path: `${process.env.SHOT}/card-ar.png` });
    await b.close();
  }
  if (arCard) await run(fork, { decisions: Object.fromEntries(arCard.items.map((i) => [i.call.id, false])) });

  c = await run(dm, { text: "DELETE-m1" });
  card = c.pending?.approval;
  check("D) deleting always asks, and can't be allowed ahead", !!card && !card.items[0].scope);
  c = await run(dm, { decisions: Object.fromEntries(card.items.map((i) => [i.call.id, false])) });
  check("D) declined: nothing deleted", !seen.deleted.length);

  c = await run(dm, { text: "SEARCH" });
  check("E) reading never asks and never waits", !c.pending?.approval && /DONE-SEARCH/.test(c.entries.at(-1).text || ""));

  const other = (await api("GET", "/api/bots")).j.find((b) => b.name === "Scout");
  await api("PUT", `/api/mcp/${add.j.id}`, { bots: [chief.botId, other.id] }).catch(() => {});
  check("F) the OK stays in its chat", !((await api("GET", `/api/chats/dm-${other.id}`)).j.allow || []).length && ((await api("GET", `/api/chats/${dm}`)).j.allow || []).some((k) => /send_email/.test(k)));

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
