// End-to-end replay of a real Telegram conversation that went wrong (stand-ins for theOovi's model on
// port 3395 and Telegram on 3394; nothing leaves this machine). The owner, Oussama, wrote in Darija:
//   "وش اخر شيئ تم تحميلو" (what was the last thing downloaded?)
// and got: his name written as "عثمان", English permission messages, the same folder asked twice,
// and finally "Quill didn't reply" although Quill had answered. Checked here:
//   1. one permission per folder per task (a search after a listing doesn't ask again),
//   2. permission messages in the user's language (Arabic here),
//   3. the answer after /yes reaches Telegram,
//   4. the bot is told to write the user's name exactly as given.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-tg-test");
const FOLDER = path.join(os.tmpdir(), "oovi-tg-downloads");
const PORT = 3306;
const MODEL_PORT = 3395;
const TG_PORT = 3394;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-tg-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- stand-in model: Quill, as on the screenshot ----------
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const systemOf = (b) => (typeof b.system === "string" ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("\n") : "");
const seen = { system: "", calls: [] };

const OTHER = path.join(os.tmpdir(), "oovi-tg-pictures");
async function answerAsync(body) {
  const lastU = [...(body.messages || [])].reverse().find((m) => m.role === "user" && (typeof m.content === "string" || (m.content || []).some((b) => b.type === "text")));
  const u = lastU ? (typeof lastU.content === "string" ? lastU.content : lastU.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")) : "";
  const lastMsg = (body.messages || []).at(-1) || {};
  const hasResult = Array.isArray(lastMsg.content) && lastMsg.content.some((b) => b.type === "tool_result");
  if (/PDF/.test(u)) {
    if (hasResult) return reply([{ type: "text", text: "Voilà ton rapport." }], "end_turn");
    return reply([{ type: "tool_use", id: `toolu_doc_${Date.now()}`, name: "create_document", input: { filename: "rapport.md", content: "# Rapport\nTout va bien." } }], "tool_use");
  }
  if (/LONG/.test(u)) {
    await sleep(8000);
    return reply([{ type: "text", text: "LONG-DONE" }], "end_turn");
  }
  return answer(body);
}
function answer(body) {
  seen.system = systemOf(body);
  const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === "user" && (typeof m.content === "string" || (m.content || []).some((b) => b.type === "text")));
  const ask = lastUser ? (typeof lastUser.content === "string" ? lastUser.content : lastUser.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")) : "";
  if (/الصور/.test(ask)) {
    const lastMsg = (body.messages || []).at(-1) || {};
    if (Array.isArray(lastMsg.content) && lastMsg.content.some((b) => b.type === "tool_result")) return reply([{ type: "text", text: "ما كاين حتى صورة." }], "end_turn");
    return reply([{ type: "tool_use", id: `toolu_pic_${Date.now()}`, name: "list_folder", input: { path: OTHER } }], "tool_use");
  }
  const last = (body.messages || []).at(-1) || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const r = results.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n");
  if (results.length && /find_files|files with|newest|\.zip/.test(r) && seen.calls.includes("find_files")) return reply([{ type: "text", text: "آخر ملف تحميلتو هو report-new.zip." }], "end_turn");
  if (results.length && seen.calls.at(-1) === "list_folder") {
    seen.calls.push("find_files");
    return reply([{ type: "tool_use", id: `toolu_ff_${Date.now()}`, name: "find_files", input: { query: "*", folder: FOLDER } }], "tool_use");
  }
  seen.calls.push("list_folder");
  return reply([{ type: "tool_use", id: `toolu_lf_${Date.now()}`, name: "list_folder", input: { path: FOLDER } }], "tool_use");
}
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
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Oussama", image: null } });
      if (url === "/api/v1/ai/messages" && req.method === "POST") return void answerAsync(JSON.parse(raw)).then((r) => send(200, r));
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

// ---------- stand-in Telegram ----------
const USER_CHAT = 222;
const updates = [];
let nextUpdate = 1;
const sent = [];
let confirmed = 0;
const userSays = (text) => {
  updates.push({ update_id: nextUpdate++, message: { message_id: nextUpdate, date: Math.floor(Date.now() / 1000), chat: { id: USER_CHAT, type: "private", first_name: "Oussama" }, from: { id: USER_CHAT, first_name: "Oussama" }, text } });
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
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = {}; // multipart (sendDocument)
      }
      if (method === "getMe") return send(200, { ok: true, result: { id: 1, is_bot: true, username: "test_oovi_bot", first_name: "oovi" } });
      if (method === "getUpdates") {
        confirmed = Math.max(confirmed, body.offset || 0);
        const fresh = () => updates.filter((u) => u.update_id >= confirmed);
        for (let i = 0; i < 10 && !fresh().length; i++) await sleep(100);
        return send(200, { ok: true, result: fresh() });
      }
      if (method === "sendDocument") {
        sent.push({ at: Date.now(), text: `[document] ${raw.match(/filename="([^"]+)"/)?.[1] ?? "?"}` });
        log(`BOT  > [document] ${raw.match(/filename="([^"]+)"/)?.[1] ?? "?"}`);
        return send(200, { ok: true, result: { message_id: sent.length } });
      }
      if (method === "sendMessage") {
        sent.push({ at: Date.now(), text: String(body.text) });
        log(`BOT  > ${String(body.text).replace(/\n/g, " | ").slice(0, 240)}`);
        return send(200, { ok: true, result: { message_id: sent.length } });
      }
      return send(200, { ok: true, result: true });
    });
  })
  .listen(TG_PORT, "127.0.0.1");

// ---------- oovi ----------
let server = null;
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TEST_USER_NAME: "Oussama", OOVI_TELEGRAM_API: `http://127.0.0.1:${TG_PORT}`, OOVI_CLOUD_URL: `http://127.0.0.1:${MODEL_PORT}`, PORT: String(PORT) },
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
      if ((await fetch(`${BASE}/api/telegram`)).ok) return;
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
    await sleep(300);
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
  fs.rmSync(FOLDER, { recursive: true, force: true });
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(path.join(FOLDER, "old-invoice.pdf"), "x");
  fs.utimesSync(path.join(FOLDER, "old-invoice.pdf"), new Date(Date.now() - 864e5), new Date(Date.now() - 864e5));
  fs.writeFileSync(path.join(FOLDER, "report-new.zip"), "y");
  startServer();
  await waitReady();
  const bots = await api("GET", "/api/bots");
  const quill = bots.find((b) => b.name === "Quill");
  await api("PUT", "/api/main", { botId: quill.id }); // the owner's Chief, as on the screenshot

  let st = await api("POST", "/api/telegram", { token: "1234567:TESTTOKEN-not-a-real-token-0123456789abc" });
  if (!st.pairLink) st = await api("GET", "/api/telegram");
  const code = String(st.pairLink || "").match(/start=(\w+)/)?.[1];
  userSays(`/start ${code}`);
  await waitFor((m) => m.text.startsWith("Connected!"), 20_000, "pairing");

  // The question, in Darija.
  const n0 = sent.length;
  userSays("وش اخر شيئ تم تحميلو");
  const ask1 = await waitFor((m) => sent.indexOf(m) >= n0 && /\/yes/.test(m.text), 30_000, "first permission");
  check("the permission request is in the user's language (Arabic)", /[؀-ۿ]/.test(ask1.text.split("\n")[0]) && !/needs your OK/.test(ask1.text), ask1.text.split("\n")[0]);

  const n1 = sent.length;
  userSays("/yes");
  const after = await waitFor((m) => sent.indexOf(m) >= n1 && !/^…|typing/.test(m.text), 30_000, "answer after /yes");
  await sleep(1500);
  const afterAll = sent.slice(n1).map((m) => m.text);
  check("one permission per folder per task: the search after the listing doesn't ask again", !afterAll.some((t) => /\/yes/.test(t)), afterAll.join(" || ").slice(0, 200));
  check("the answer after /yes reaches Telegram (no \"didn't reply\")", afterAll.some((t) => /report-new\.zip/.test(t)) && !afterAll.some((t) => /didn't reply|ما رد|لم يرد/.test(t)), after.text.slice(0, 120));

  // The OK covered that folder for that task only: another folder, in a new question, asks again.
  fs.mkdirSync(OTHER, { recursive: true });
  const n2 = sent.length;
  userSays("وين الصور");
  const ask2 = await waitFor((m) => sent.indexOf(m) >= n2 && /\/yes/.test(m.text), 30_000, "permission for another folder");
  check("another folder in a new question still asks", /oovi-tg-pictures/.test(ask2.text));
  const n3 = sent.length;
  userSays("/no");
  await waitFor((m) => sent.indexOf(m) >= n3, 30_000, "answer after /no");

  // /stop while a long task runs: it stops right away (it doesn't wait behind the busy chat).
  const n4 = sent.length;
  userSays("LONG job please");
  await sleep(1500);
  userSays("/stop");
  const stopped = await waitFor((m) => sent.indexOf(m) >= n4 && /Stopped|Arrêté|تم الإيقاف/.test(m.text), 6000, "stop reply");
  await sleep(8000);
  check("/stop stops a running task from Telegram", !!stopped && !sent.slice(n4).some((m) => /LONG-DONE/.test(m.text)));

  // A document the bot makes reaches Telegram, not just "saved in Downloads/oovi".
  const n5 = sent.length;
  userSays("fais-moi un PDF du rapport");
  await waitFor((m) => sent.indexOf(m) >= n5 && /Voilà ton rapport/.test(m.text), 30_000, "report reply");
  check("a document the bot creates is sent to Telegram", sent.slice(n5).some((m) => /\[document\] rapport\.md/.test(m.text)), sent.slice(n5).map((m) => m.text).join(" || ").slice(0, 160));

  check("the bot is told to write the user's name exactly as given", /Oussama/.test(seen.system) && /exactly as written/.test(seen.system));

  const ok = results.filter((r) => r.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
