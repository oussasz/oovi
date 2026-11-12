// End-to-end check of Phase 1 against the built oovi server, with nothing leaving this machine:
// a scripted stand-in for theOovi's model (port 3399) and for Telegram's Bot API (port 3398).
// Scenarios: A) a group pauses for the user's OK, answered "نعم" from Telegram, result arrives;
// B) a group takes longer than message_group's wait, Telegram fails twice, result still arrives;
// C) oovi is killed mid-task and restarted: the user is told it didn't finish, nothing spins.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-phase1-test");
const PORT = 3301;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-phase1-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- stand-in theOovi model ----------
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
let modelCalls = 0;

async function answer(body) {
  modelCalls++;
  const tools = (body.tools || []).map((t) => t.name || t.type);
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  // The scenario word of the newest user message that has one.
  const words = msgs.map(textOf).join(" ").match(/\b(APPROVE|SLOW|CRASH)\b/g) || [];
  const kw = words[words.length - 1] || "NONE";
  if (tools.includes("message_group")) {
    if (results.length) return reply([{ type: "text", text: `MAIN-REPLY(${kw}): ${JSON.stringify(results[0].content).slice(0, 160)}` }], "end_turn");
    return reply([{ type: "tool_use", id: `toolu_mg_${Date.now()}`, name: "message_group", input: { group: "Studio Test", message: `Please do this: ${kw} task` } }], "tool_use");
  }
  if (!tools.includes("save_skill")) return reply([{ type: "text", text: "ok" }], "end_turn"); // reflection etc.
  if (results.length) return reply([{ type: "text", text: `GROUP-FINAL-RESULT ${kw}` }], "end_turn");
  if (kw === "APPROVE") return reply([{ type: "tool_use", id: `toolu_sk_${Date.now()}`, name: "save_skill", input: { name: "Demo skill", description: "A demo", instructions: "Do it." } }], "tool_use");
  if (kw === "SLOW") await sleep(140_000);
  if (kw === "CRASH") await sleep(90_000);
  return reply([{ type: "text", text: `GROUP-FINAL-RESULT ${kw}` }], "end_turn");
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const send = (code, obj) => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(code, { "content-type": "application/json" });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      const url = req.url.split("?")[0];
      if (url === "/api/v1/ai/status") return send(200, status);
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Phase Tester", image: null } });
      const refused = url === "/api/v1/ai/messages" && req.method === "POST" ? require("./model-rules.cjs").refusal(JSON.parse(raw)) : null;
      if (refused) return send(400, { error: refused });
      if (url === "/api/v1/ai/messages" && req.method === "POST" && require("./model-rules.cjs").isDoneCheck(JSON.parse(raw))) return send(200, require("./model-rules.cjs").doneReply(JSON.parse(raw)));
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        try {
          return send(200, await answer(JSON.parse(raw)));
        } catch (e) {
          return send(400, { error: String(e) });
        }
      }
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      return send(204);
    });
  })
  .listen(3399, "127.0.0.1");

// ---------- stand-in Telegram Bot API ----------
const USER_CHAT = 111;
const updates = [];
let nextUpdate = 1;
const sent = [];
let failSends = 0;
let confirmed = 0;
const userSays = (text) => {
  updates.push({ update_id: nextUpdate++, message: { message_id: nextUpdate, date: Math.floor(Date.now() / 1000), chat: { id: USER_CHAT, type: "private", first_name: "Tester" }, from: { id: USER_CHAT, first_name: "Tester" }, text } });
  log(`USER > ${text}`);
};

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const method = req.url.split("/").pop().split("?")[0];
      const body = raw ? JSON.parse(raw) : {};
      if (method === "getMe") return send(200, { ok: true, result: { id: 1, is_bot: true, username: "test_oovi_bot", first_name: "oovi" } });
      if (method === "getUpdates") {
        // Like Telegram: asking with offset N confirms (forgets) every update before N.
        confirmed = Math.max(confirmed, body.offset || 0);
        const fresh = () => updates.filter((u) => u.update_id >= confirmed);
        for (let i = 0; i < 10 && !fresh().length; i++) await sleep(100);
        return send(200, { ok: true, result: fresh() });
      }
      if (method === "sendChatAction") return send(200, { ok: true, result: true });
      if (method === "sendMessage") {
        if (failSends > 0) {
          failSends--;
          log(`TELEGRAM refused a send (simulated outage): ${String(body.text).slice(0, 60)}`);
          return send(502, { ok: false, error_code: 502, description: "Bad Gateway" });
        }
        sent.push({ at: Date.now(), text: String(body.text) });
        log(`BOT  > ${String(body.text).replace(/\n/g, " | ").slice(0, 220)}`);
        return send(200, { ok: true, result: { message_id: sent.length } });
      }
      return send(200, { ok: true, result: true });
    });
  })
  .listen(3398, "127.0.0.1");

// ---------- the oovi server ----------
let server = null;
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:3398", OOVI_CLOUD_URL: "http://127.0.0.1:3399", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => fs.appendFileSync(LOG, `   [server] ${d}`));
  server.stderr.on("data", (d) => fs.appendFileSync(LOG, `   [server!] ${d}`));
}
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/telegram`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("server didn't start");
}
async function waitFor(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = sent.find(pred);
    if (hit) return hit;
    await sleep(500);
  }
  throw new Error(`timed out waiting for: ${what}`);
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  log("server ready");
  const bots = await api("GET", "/api/bots");
  const list = Array.isArray(bots) ? bots : bots.bots;
  const main = list[0];
  const lead = list[1];
  const mate = list[2];
  await api("POST", "/api/main", { botId: main.id });
  const group = await api("POST", "/api/chats", { name: "Studio Test", memberIds: [lead.id, mate.id], leadId: lead.id });
  log(`main bot ${main.name}, group ${group.name} led by ${lead.name}`);
  let st = await api("POST", "/api/telegram", { token: "1234567:TESTTOKEN-not-a-real-token-0123456789abc" });
  if (!st.pairLink) st = await api("GET", "/api/telegram");
  log(`telegram status: ${JSON.stringify(st).slice(0, 300)}`);
  const code = String(st.pairLink || "").match(/start=(\w+)/)?.[1];
  userSays(`/start ${code}`);
  await waitFor((m) => m.text.startsWith("Connected!"), 20_000, "pairing");
  check("pairing over the stand-in Telegram", true);

  // ---- A: the group pauses for the user's OK, answered in Algerian Arabic from Telegram ----
  let mark = sent.length;
  userSays("APPROVE: ask Studio Test to save a skill");
  const a1 = await waitFor((m) => sent.indexOf(m) >= mark && m.text.includes("MAIN-REPLY(APPROVE)"), 60_000, "main bot reply A");
  check("A: main bot says the group waits for an OK", /waiting for the user's OK/.test(a1.text), a1.text.slice(0, 120));
  mark = sent.length;
  userSays("نعم");
  const a2 = await waitFor((m) => sent.indexOf(m) >= mark && m.text.includes("goes on"), 30_000, "ack for نعم");
  check("A: 'نعم' answers the group's request from the main chat", true, a2.text);
  const a3 = await waitFor((m) => sent.indexOf(m) >= mark && m.text.includes("GROUP-FINAL-RESULT APPROVE"), 60_000, "group result A");
  check("A: the group's final answer arrives on Telegram after the OK", /Studio Test finished/.test(a3.text), a3.text.slice(0, 100));
  await sleep(1500);
  const dm = await api("GET", `/api/chats/dm-${main.id}`);
  check("A: the result is also in the main bot's chat in the app", JSON.stringify(dm).includes("GROUP-FINAL-RESULT APPROVE"));

  // ---- B: longer than the 2-minute wait, and Telegram fails the first two sends of the result ----
  mark = sent.length;
  userSays("SLOW: ask Studio Test for a long job");
  const b1 = await waitFor((m) => sent.indexOf(m) >= mark && m.text.includes("MAIN-REPLY(SLOW)"), 180_000, "main bot reply B");
  check("B: after the wait, the main bot says the group is still working", /still working/.test(b1.text), b1.text.slice(0, 120));
  failSends = 2;
  const b2 = await waitFor((m) => sent.indexOf(m) >= mark && m.text.includes("GROUP-FINAL-RESULT SLOW"), 180_000, "group result B");
  check("B: the long job's result arrives despite two failed sends", /Studio Test finished/.test(b2.text) && failSends === 0, b2.text.slice(0, 100));

  // ---- C: oovi is killed mid-task and restarted ----
  mark = sent.length;
  userSays("CRASH: ask Studio Test for something");
  await sleep(25_000);
  const accDir = path.join(DATA, "accounts", fs.readdirSync(path.join(DATA, "accounts")).find((d) => fs.statSync(path.join(DATA, "accounts", d)).isDirectory()));
  const pending = JSON.parse(fs.readFileSync(path.join(accDir, "delegations.json"), "utf8"));
  check("C: the task is on disk while the group works", pending.length === 1 && pending[0].inline === true, JSON.stringify(pending.map((d) => ({ inline: d.inline }))));
  server.kill("SIGKILL");
  log("server killed mid-task");
  await sleep(2000);
  startServer();
  await waitReady();
  log("server restarted");
  const c1 = await waitFor((m) => sent.indexOf(m) >= mark && /Studio Test.*couldn't finish/.test(m.text), 90_000, "report after restart");
  check("C: after a restart the user is told the group didn't finish", /oovi closed before this finished/.test(c1.text), c1.text.slice(0, 140));
  const g2 = await api("GET", `/api/chats/${group.id}`);
  const spinning = (g2.entries || []).filter((e) => e.kind === "bot" && e.status === "running").length;
  check("C: nothing is left showing 'working…' in the group", spinning === 0);
  const dm2 = await api("GET", `/api/chats/dm-${main.id}`);
  check("C: nothing is left showing 'working…' in the main chat", (dm2.entries || []).filter((e) => e.kind === "bot" && e.status === "running").length === 0);

  log(`model calls: ${modelCalls}`);
  log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
