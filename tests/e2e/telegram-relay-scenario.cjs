// Telegram through the oovi service (lib/telegram.ts "relay"; the service side is web/lib/telegram-relay.ts):
// the built app pairs and answers through a stand-in service that queues Telegram's messages, never asks
// Telegram itself for updates while the relay is on, registers the paired chat (so the service knows whom
// to tell "open oovi"), doesn't answer a message twice after a restart, falls back to Telegram directly
// when the service is gone, and turns the relay off when Telegram is disconnected.
// Run: node tests/e2e/telegram-relay-scenario.cjs (after npm run build).
const http = require("node:http");
const { asModel } = require("./all-tools.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-tg-relay-test");
const PORT = 3316;
const CLOUD_PORT = 3397;
const TG_PORT = 3398;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
};

// ---------- stand-in oovi service: the model, and the relay ----------
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const relay = { on: true, registrations: [], inbox: [], nextId: 1, deleted: 0, polls: 0, conn: null, disconnectedAt: 0, devices: new Set() };
let answered = 0;
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
      const q = new URL(req.url, "http://x").searchParams;
      if (url === "/api/v1/ai/status") return send(200, status);
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Tester", image: null } });
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        const rules = require("./model-rules.cjs");
        const body = asModel(JSON.parse(raw));
        if (rules.isDoneCheck(body)) return send(200, rules.doneReply(body));
        answered++;
        return send(200, { id: "msg", type: "message", role: "assistant", model: "theOovi", content: [{ type: "text", text: `Answer number ${answered}` }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 5 }, oovi: live() });
      }
      if (url === "/api/v1/telegram/relay" && req.method === "POST") {
        if (!relay.on) return send(404, { error: "no" });
        const b = asModel(JSON.parse(raw));
        if (relay.disconnectedAt && (b.connectedAt || 0) <= relay.disconnectedAt) return send(410, { error: "disconnected elsewhere" });
        relay.registrations.push(b);
        relay.conn = { token: b.token, config: b.config, connectedAt: b.connectedAt };
        return send(200, { ok: true });
      }
      if (url === "/api/v1/telegram/relay" && req.method === "DELETE") {
        relay.deleted++;
        relay.conn = null;
        relay.disconnectedAt = Date.now();
        return send(204);
      }
      if (url === "/api/v1/telegram/relay" && req.method === "GET") {
        if (relay.conn) return send(200, relay.conn);
        return relay.disconnectedAt ? send(200, { disconnectedAt: relay.disconnectedAt }) : send(404, { error: "none" });
      }
      if (url === "/api/v1/telegram/updates") {
        if (!relay.on || (relay.disconnectedAt && !relay.conn)) return send(404, { error: "off" });
        relay.polls++;
        relay.devices.add(q.get("device"));
        const after = Number(q.get("after") || 0);
        relay.inbox = relay.inbox.filter((x) => x.id > after);
        for (let i = 0; i < 20 && !relay.inbox.length; i++) await sleep(100);
        return send(200, { updates: relay.inbox.filter((x) => x.id > after) });
      }
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      return send(204);
    });
  })
  .listen(CLOUD_PORT, "127.0.0.1");

// ---------- stand-in Telegram ----------
const CHAT = 4242;
let updateId = 1;
const sent = [];
const tgCalls = [];
const direct = [];
const userSays = (text) => {
  const u = { update_id: updateId++, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: CHAT, type: "private", first_name: "T" }, from: { id: CHAT, first_name: "T" }, text } };
  if (relay.on) relay.inbox.push({ id: relay.nextId++, update: u });
  else direct.push(u);
};
http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const send = (obj) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const method = req.url.split("/").pop().split("?")[0];
      tgCalls.push(method);
      const body = raw ? asModel(JSON.parse(raw)) : {};
      if (method === "getMe") return send({ ok: true, result: { id: 1, is_bot: true, username: "relay_test_bot", first_name: "oovi" } });
      if (method === "getUpdates") {
        const fresh = direct.filter((u) => u.update_id >= (body.offset || 0));
        if (!fresh.length) await sleep(300);
        return send({ ok: true, result: fresh });
      }
      if (method === "sendMessage") {
        sent.push(String(body.text));
        return send({ ok: true, result: { message_id: sent.length } });
      }
      return send({ ok: true, result: true });
    });
  })
  .listen(TG_PORT, "127.0.0.1");

// ---------- oovi ----------
let server = null;
const start = () => {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: `http://127.0.0.1:${TG_PORT}`, OOVI_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}`, PORT: String(PORT) },
    stdio: "ignore",
  });
};
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const ready = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/telegram`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("server didn't start");
};
const waitSent = async (pred, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (sent.some(pred)) return true;
    await sleep(200);
  }
  throw new Error(`timed out: ${what}`);
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  try {
    start();
    await ready();
    let st = await api("POST", "/api/telegram", { token: "1234567:TESTTOKEN-not-a-real-token-0123456789abc" });
    if (!st.pairLink) st = await api("GET", "/api/telegram");
    const code = String(st.pairLink || "").match(/start=(\w+)/)?.[1];
    for (let i = 0; i < 50 && !relay.registrations.length; i++) await sleep(200);
    check("the app turns the relay on with its bot token", relay.registrations.length > 0 && /TESTTOKEN/.test(relay.registrations[0].token));
    userSays(`/start ${code}`);
    await waitSent((t) => t.startsWith("Connected!"), 20_000, "pairing");
    check("pairing works through the relay", true);
    for (let i = 0; i < 50 && !relay.registrations.some((r) => r.chats.includes(CHAT)); i++) await sleep(200);
    check("the paired chat is registered (the service knows whom to tell 'open oovi')", relay.registrations.some((r) => r.chats.includes(CHAT)));
    check("the notice language is sent", relay.registrations.every((r) => /^[a-z]{2}$/.test(r.language)));

    userSays("hello");
    await waitSent((t) => /Answer number/.test(t), 30_000, "answer");
    check("a message through the relay gets the bot's answer on Telegram", true);
    check("Telegram itself is never asked for updates while the relay is on", !tgCalls.includes("getUpdates"));

    // Restart: what was answered isn't answered again.
    const answersBefore = sent.filter((t) => /Answer number/.test(t)).length;
    server.kill();
    await sleep(1000);
    start();
    await ready();
    await sleep(6000);
    check("after a restart, nothing is answered twice", sent.filter((t) => /Answer number/.test(t)).length === answersBefore);

    // The service goes away: the app reads Telegram directly.
    relay.on = false;
    const before = tgCalls.filter((m) => m === "getUpdates").length;
    for (let i = 0; i < 60 && tgCalls.filter((m) => m === "getUpdates").length === before; i++) await sleep(250);
    check("service gone: the app stops Telegram's webhook and reads Telegram directly", tgCalls.includes("deleteWebhook") && tgCalls.filter((m) => m === "getUpdates").length > before);
    userSays("still there?");
    await waitSent((t) => /Answer number/.test(t) && sent.filter((x) => /Answer number/.test(x)).length > answersBefore, 30_000, "direct answer");
    check("…and still answers", true);

    check("each computer says which one it is", [...relay.devices].every((d) => /^[0-9a-f]{24}$/.test(d)));

    // A second computer of the same account connects to the same bot by itself.
    relay.on = true;
    const PC2 = path.join(os.tmpdir(), "oovi-tg-relay-test-2");
    fs.rmSync(PC2, { recursive: true, force: true });
    const pc2 = spawn(process.execPath, [path.join(__dirname, "server.cjs")], { env: { ...process.env, OOVI_TEST_DATA: PC2, OOVI_TELEGRAM_API: `http://127.0.0.1:${TG_PORT}`, OOVI_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}`, PORT: String(PORT + 1) }, stdio: "ignore" });
    const base2 = `http://127.0.0.1:${PORT + 1}`;
    let st2 = {};
    for (let i = 0; i < 80; i++) {
      try {
        st2 = await (await fetch(`${base2}/api/telegram`)).json();
        if (st2.connected) break;
      } catch {}
      await sleep(500);
    }
    check("a second computer connects to the same bot by itself, already paired", st2.connected === true && st2.botUsername === "relay_test_bot", JSON.stringify(st2).slice(0, 160));

    // Disconnect Telegram in Settings: the service forgets the bot, on every computer.
    await api("DELETE", "/api/telegram");
    for (let i = 0; i < 40 && !relay.deleted; i++) await sleep(250);
    check("disconnecting Telegram turns the relay off on the service", relay.deleted > 0);
    // The second computer, still connected from before, lets go too (the service answers 410 when it registers).
    let off2 = false;
    for (let i = 0; i < 40 && !off2; i++) {
      await fetch(`${base2}/api/telegram`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
      const s2 = await (await fetch(`${base2}/api/telegram`)).json().catch(() => ({}));
      off2 = s2.hasToken === false;
      if (!off2) await sleep(500);
    }
    check("…and the other computer disconnects too", off2);
    pc2.kill();
  } catch (e) {
    check("scenario ran", false, e.message);
  } finally {
    server?.kill();
  }
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
