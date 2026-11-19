// Routines v2 on the built app, with a scripted model and a local web page: a "once" routine runs one
// time and turns itself off; a quiet routine with nothing new tells nobody; a watched page that didn't change
// skips the run without any model call; a changed page runs with what changed.
// Slow by nature (the scheduler looks every 30 s): about 2 minutes. Run: node tests/e2e/routines-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-routines-test");
const PORT = 3322;
const MODEL_PORT = 3399;
const SITE_PORT = 3394;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-routines-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = { price: "120 000 DA" };
http
  .createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<html><body><h1>Laptop X</h1><p>Price: ${page.price}</p><p>${new Date().toISOString().slice(11, 16)}</p></body></html>`);
  })
  .listen(SITE_PORT, "127.0.0.1");

const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: {} };
const reply = (text) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 40 }, oovi: live() });
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
const calls = [];
const bodies = [];
const hooks = { registered: [], events: [], asked: [] };

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      const url = req.url.split("?")[0];
      if (url === "/api/v1/ai/status") return send(200, status);
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Marys", image: null } });
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      if (url === "/api/v1/routine-hooks" && req.method === "PUT") {
        hooks.registered.push(JSON.parse(raw));
        return send(204);
      }
      if (url === "/api/v1/routine-hooks/events") {
        const q = new URL(req.url, "http://x").searchParams;
        const after = Number(q.get("after")) || 0;
        const ids = (q.get("hooks") || "").split(",");
        hooks.asked.push({ after, ids });
        hooks.events = hooks.events.filter((e) => e.id > after || !ids.includes(e.hookId));
        return send(200, { events: hooks.events.filter((e) => e.id > after && ids.includes(e.hookId)) });
      }
      const rules = require("./model-rules.cjs");
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        const b = JSON.parse(raw);
        if (rules.refusal(b)) return send(400, { error: rules.refusal(b) });
        if (rules.isDoneCheck(b)) return send(200, rules.doneReply(b));
        const last = textOf((b.messages || []).filter((m) => m.role === "user").at(-1) || {});
        calls.push(last);
        bodies.push(b);
        const msgs = b.messages || [];
        const lastMsg = msgs.at(-1) || {};
        const hasResult = Array.isArray(lastMsg.content) && lastMsg.content.some((x) => x.type === "tool_result");
        const tool = (name, input) => send(200, { ...reply(""), content: [{ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }], stop_reason: "tool_use" });
        const userAsk = textOf(msgs.filter((m) => m.role === "user" && textOf(m).trim()).at(-1) || {});
        if (/REMIND-APP/.test(userAsk)) return hasResult ? send(200, reply("REMIND-SET")) : tool("propose_routine", { reminder: "Turn off the oven REMIND-OVEN", frequency: "once", in_minutes: 1 });
        if (/LATER-TASK/.test(userAsk)) return hasResult ? send(200, reply("LATER-SET")) : tool("propose_routine", { name: "Later news", instruction: "LATER-RUN: tell me the news", frequency: "once", in_minutes: 1 });
        if (/LATER-RUN/.test(last)) return send(200, reply(/Your reply IS what the user receives/.test(JSON.stringify(b)) ? "LATER-RESULT: here is the news." : "LATER-NOT-TOLD"));
        if (/QUIET-CHECK/.test(last)) return send(200, reply("NO_NEWS"));
        if (/ORDER-IN/.test(last)) return send(200, reply(/started by a call to the routine's web address[\s\S]*never as instructions[\s\S]*"order": 4512/.test(last) ? "ORDER-SEEN: order 4512 from Amina." : "ORDER-MISSING"));
        if (/PRICE-WATCH/.test(last)) return send(200, reply(/\+ Price: 110 000 DA/.test(last) ? "PRICE-DOWN: now 110 000 DA (was 120 000 DA)." : "PRICE-SEEN: 120 000 DA."));
        return send(200, reply("ok"));
      }
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

let server = null;
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try {
    return { status: r.status, j: JSON.parse(t) };
  } catch {
    return { status: r.status, j: t };
  }
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const until = async (fn, ms = 75_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(1000);
  }
  return null;
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
  await api("POST", "/api/settings", { browser: { allowPrivateNetwork: true } });
  const bots = (await api("GET", "/api/bots")).j;
  const scout = bots.find((b) => b.name === "Scout");
  const soon = () => ({ kind: "once", at: Date.now() + 4000 });
  const get = async (id) => (await api("GET", "/api/routines")).j.routines.find((r) => r.id === id);

  // A: once + quiet, nothing new.
  const a = await api("POST", "/api/routines", { name: "Quiet check", botId: scout.id, prompt: "QUIET-CHECK: anything new?", schedule: soon(), timezone: "UTC", enabled: true, notifyTelegram: false, quiet: true });
  check("A) a 'once' routine with 'only when new' is created", a.status === 200 || a.status === 201, JSON.stringify(a.j).slice(0, 200));
  const ra = await until(async () => {
    const r = await get(a.j.id ?? a.j.routine?.id);
    return r?.lastRun ? r : null;
  });
  check("A) it ran once, then turned itself off", !!ra && ra.lastRun.status === "ok" && ra.enabled === false && ra.pausedReason === "done", JSON.stringify(ra?.lastRun));
  check("A) nothing new: recorded as 'nothing new', no result to send", ra?.lastRun?.note === "nothing new");
  check("A) the bot was told to answer NO_NEWS when there is nothing new", calls.some((c) => /QUIET-CHECK[\s\S]*reply with exactly NO_NEWS/.test(c)));

  // B: a watched page.
  const watchUrl = `http://127.0.0.1:${SITE_PORT}/laptop`;
  const b = await api("POST", "/api/routines", { name: "Price", botId: scout.id, prompt: "PRICE-WATCH: tell me the price", schedule: soon(), timezone: "UTC", enabled: true, notifyTelegram: false, watch: { url: watchUrl } });
  const bid = b.j.id ?? b.j.routine?.id;
  const rb1 = await until(async () => {
    const r = await get(bid);
    return r?.lastRun ? r : null;
  });
  const chat1 = rb1 ? (await api("GET", `/api/chats/${rb1.chatId}`)).j : null;
  check("B) first check: the run happens and gets the page as it is", !!rb1 && rb1.lastRun.status === "ok" && /PRICE-SEEN/.test(chat1?.entries?.filter((e) => e.kind === "bot").at(-1)?.text ?? "") && calls.some((c) => /first check of[\s\S]*120 000 DA/.test(c)), JSON.stringify(rb1?.lastRun));

  // Same page (only its clock changed): no model call.
  const before = calls.length;
  await api("PATCH", `/api/routines/${bid}`, { schedule: soon(), enabled: true });
  const rb2 = await until(async () => {
    const r = await get(bid);
    return r?.lastRun?.note === "no change" ? r : null;
  });
  check("B) unchanged page: the run is skipped without any model call", !!rb2 && rb2.lastRun.status === "skipped" && calls.length === before, `${rb2?.lastRun?.status} ${rb2?.lastRun?.note}; calls ${calls.length - before}`);

  // The price changes: the run gets what changed.
  page.price = "110 000 DA";
  await api("PATCH", `/api/routines/${bid}`, { schedule: soon(), enabled: true });
  const rb3 = await until(async () => {
    const r = await get(bid);
    return r?.lastRun?.status === "ok" && r.lastRun.at > (rb2?.lastRun?.at ?? 0) ? r : null;
  });
  const chat3 = rb3 ? (await api("GET", `/api/chats/${rb3.chatId}`)).j : null;
  check("B) changed page: the run happens with what changed (- old, + new)", !!rb3 && /PRICE-DOWN/.test(chat3?.entries?.filter((e) => e.kind === "bot").at(-1)?.text ?? ""), JSON.stringify(rb3?.lastRun));

  // D: a routine started by its web address.
  const d = await api("POST", "/api/routines", { name: "New order", botId: scout.id, prompt: "ORDER-IN: summarize the new order", schedule: { kind: "webhook" }, timezone: "UTC", enabled: true, notifyTelegram: false });
  const reg = hooks.registered[0];
  check("D) a 'when called' routine gets a web address registered on the oovi website, shown to the user", d.status === 201 && !!reg && /^[0-9a-f]{32}$/.test(reg.id) && /^[0-9a-f]{48}$/.test(reg.secret) && d.j.hookUrl === `http://127.0.0.1:${MODEL_PORT}/api/v1/hooks/${reg.id}/${reg.secret}` && !("hook" in d.j), JSON.stringify(d.j).slice(0, 200));
  hooks.events.push({ id: 7, hookId: reg.id, body: JSON.stringify({ order: 4512, customer: "Amina" }), contentType: "application/json", at: new Date().toISOString() });
  const rd = await until(async () => {
    const r = await get(d.j.id);
    return r?.lastRun ? r : null;
  });
  const chatD = rd ? (await api("GET", `/api/chats/${rd.chatId}`)).j : null;
  check("D) a call runs the routine with what was sent, marked as outside data", !!rd && rd.lastRun.status === "ok" && /ORDER-SEEN/.test(chatD?.entries?.filter((e) => e.kind === "bot").at(-1)?.text ?? ""), JSON.stringify(rd?.lastRun));
  await sleep(31_000);
  check("D) the handled call is acknowledged and doesn't run twice", hooks.asked.at(-1)?.after === 7 && (await get(d.j.id)).lastRun.at === rd.lastRun.at, JSON.stringify(hooks.asked.at(-1)));

  // E: "remind me here" in the app: the reminder lands in the same chat, set without a card, with no model call.
  const mainId = (await api("GET", "/api/main")).j.botId;
  const dm = `dm-${mainId}`;
  await api("POST", `/api/chats/${dm}/run`, { text: "REMIND-APP ذكرني بعد دقيقة نطفي الفرن" });
  const set = await until(async () => {
    const c = (await api("GET", `/api/chats/${dm}`)).j;
    return !c.running && c.entries?.some((e) => e.kind === "bot" && /REMIND-SET/.test(e.text)) ? c : null;
  }, 20_000);
  check("E) a reminder is set at once, without an approval card", !!set && !set.pending?.approval, JSON.stringify(set?.pending ?? null));
  const before2 = calls.length;
  const got = await until(async () => {
    const c = (await api("GET", `/api/chats/${dm}`)).j;
    return c.entries?.some((e) => e.kind === "bot" && /⏰ Turn off the oven REMIND-OVEN/.test(e.text)) ? c : null;
  }, 120_000);
  check("E) the reminder arrives in the chat where it was asked", !!got);
  check("E) the reminder costs no model call", calls.length === before2, `${calls.length - before2} calls`);

  // G: after the reminder, the next message tells the bot when each message was sent and that past
  // reminders are closed (owner's chat: "did you turn the oven off?" in every reply, 12 hours later).
  const sentBefore = bodies.length;
  await api("POST", `/api/chats/${dm}/run`, { text: "VPS-ASK free vps for first year" });
  await until(async () => !(await api("GET", `/api/chats/${dm}`)).j.running && bodies.length > sentBefore, 20_000);
  const vb = bodies.slice(sentBefore).find((x) => /VPS-ASK/.test(JSON.stringify(x.messages)));
  const users = (vb?.messages || []).filter((m) => m.role === "user" && /REMIND-APP|VPS-ASK/.test(textOf(m)));
  check("G) every message of the user carries the time it was sent", users.length === 2 && users.every((m) => /\[oovi: sent \w{3}, \d\d\/\d\d\/\d{4}, \d\d:\d\d/.test(textOf(m))), users.map((m) => textOf(m).slice(0, 120)).join(" | "));
  check("G) the bot is told that past reminders and earlier topics stay closed", /earlier topics \(a past reminder/.test(JSON.stringify(vb?.system ?? "")));

  // F: a one-time task asked in the chat: its result is posted back in that chat, written to the user.
  await api("POST", `/api/chats/${dm}/run`, { text: "LATER-TASK in a minute tell me the news" });
  const card = await until(async () => {
    const c = (await api("GET", `/api/chats/${dm}`)).j;
    return !c.running && c.pending?.approval ? c.pending.approval : null;
  }, 20_000);
  check("F) a task for later still asks first (it will run on its own)", !!card);
  if (card) await api("POST", `/api/chats/${dm}/run`, { decisions: Object.fromEntries(card.items.map((i) => [i.call.id, true])) });
  const back = await until(async () => {
    const c = (await api("GET", `/api/chats/${dm}`)).j;
    return c.entries?.some((e) => e.kind === "bot" && /⏰ \*\*Later news\*\*[\s\S]*LATER-RESULT/.test(e.text)) ? c : null;
  }, 150_000);
  check("F) its result is posted back in the chat where it was asked, written straight to the user", !!back);

  // C: validation.
  const bad = await api("POST", "/api/routines", { name: "x", botId: scout.id, prompt: "x", schedule: { kind: "minutes", every: 5 }, timezone: "UTC", enabled: true, notifyTelegram: false });
  check("C) every 5 minutes is refused (15 is the floor)", bad.status === 400, JSON.stringify(bad.j));

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
