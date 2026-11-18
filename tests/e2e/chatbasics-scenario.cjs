// Chat basics through the app's own API: a reply quotes the message it answers (and the bot reads the quote),
// a chat is copied from one message without touching the original, search finds messages in every chat
// (any case, accents, Arabic vowel marks), a chat downloads as Markdown, and pinning works while bots work.
// Scripted model, nothing leaves this machine. Run: node tests/e2e/chatbasics-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-chatbasics-test");
const PORT = 3325;
const MODEL_PORT = 3394;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-chatbasics-log.txt");
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
const seen = { bodies: [] };
async function answer(body) {
  seen.bodies.push(body);
  const last = textOf(body.messages.at(-1));
  if (/SLOW/.test(last)) await sleep(2500);
  return reply([{ type: "text", text: /Blida/.test(last) ? "Blida has 12 cafés." : "Oran has 30 cafés, مَقْهَى included." }], "end_turn");
}
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
  const scout = bots.find((b) => b.name === "Scout");
  const dm = `dm-${scout.id}`;
  const idle = async (chat = dm) => {
    for (let i = 0; i < 400; i++) {
      const c = (await api("GET", `/api/chats/${chat}`)).j;
      if (!c.running) return c;
      await sleep(250);
    }
    throw new Error("the run didn't end");
  };

  const run = async (chat, text, extra = {}) => {
    const r = await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...extra }) });
    await r.text();
    return idle(chat);
  };
  let c = await run(dm, "Find cafes in Oran");
  const first = c.entries.find((e) => e.kind === "bot");
  c = await run(dm, "And Blida?", { replyTo: first.id });
  const u = c.entries.filter((e) => e.kind === "user").at(-1);
  check("A) the reply keeps a short quote of the message it answers", u.replyTo?.id === first.id && u.replyTo.who === "Scout" && /^Oran has 30/.test(u.replyTo.text), JSON.stringify(u.replyTo));
  const sent = textOf(seen.bodies.at(-1).messages.at(-1));
  check("A) the bot reads the quote with the message", /^\[Replying to Scout's message: "Oran has 30 cafés/.test(sent), sent.slice(0, 90));
  c = await run(dm, "unknown reply target", { replyTo: "nope" });
  check("A) a reply to a message that isn't there is a plain message", !c.entries.at(-2).replyTo);

  const f = await api("POST", `/api/chats/${dm}/fork`, { entryId: first.id });
  const copy = (await api("GET", `/api/chats/${f.j.id}`)).j;
  check("B) a copy holds the chat up to that message", f.status === 201 && copy.entries.length === 2 && copy.name === "Scout · copy" && copy.kind === "direct" && copy.forkOf?.entryId === first.id);
  check("B) the original is untouched", (await api("GET", `/api/chats/${dm}`)).j.entries.length === 6);
  const cc = await run(f.j.id, "And Blida?");
  check("B) the copy answers on its own, with the same bot", cc.entries.length === 4 && cc.entries.at(-1).botId === scout.id && (await api("GET", `/api/chats/${dm}`)).j.entries.length === 6);
  const list = (await api("GET", "/api/chats")).j;
  check("B) the chat list shows it as a copy", list.some((x) => x.id === f.j.id && x.fork === true && x.name === "Scout · copy"));
  check("B) a missing message can't be copied", (await api("POST", `/api/chats/${dm}/fork`, { entryId: "nope" })).status === 404);

  const s1 = (await api("GET", `/api/search?q=${encodeURIComponent("CAFES blida")}`)).j.hits;
  check("C) search finds every word, any case and accents, in every chat", s1.length === 2 && s1.every((h) => /Blida has 12/.test(h.snippet)) && new Set(s1.map((h) => h.chatId)).size === 2, JSON.stringify(s1).slice(0, 200));
  const s2 = (await api("GET", `/api/search?q=${encodeURIComponent("مقهى")}`)).j.hits;
  check("C) Arabic without vowel marks finds the word with them", s2.length >= 1 && s2[0].chat, JSON.stringify(s2).slice(0, 160));
  check("C) a one-letter search returns nothing", (await api("GET", "/api/search?q=a")).j.hits.length === 0);

  const ex = await fetch(`${BASE}/api/chats/${dm}/export`);
  const md = await ex.text();
  check("D) the chat downloads as Markdown", ex.ok && /text\/markdown/.test(ex.headers.get("content-type")) && /attachment/.test(ex.headers.get("content-disposition")) && /^# Scout/.test(md) && /> Scout: Oran has 30/.test(md));

  const slow = fetch(`${BASE}/api/chats/${dm}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "SLOW one" }) }).then((r) => r.text());
  await sleep(700);
  const pin = await api("PUT", `/api/chats/${dm}`, { pinned: true });
  await slow;
  await idle(dm);
  const after = (await api("GET", "/api/chats")).j.find((x) => x.id === dm);
  check("E) a chat can be pinned while its bot works, and stays pinned after", pin.status === 200 && after.pinned === true && (await api("GET", `/api/chats/${dm}`)).j.pinned === true);
  await api("PUT", `/api/chats/${dm}`, { pinned: false });
  check("E) and unpinned", !(await api("GET", "/api/chats")).j.find((x) => x.id === dm).pinned);
  await api("PUT", `/api/chats/${f.j.id}`, { pinned: true });
  await api("DELETE", `/api/chats/${f.j.id}`);
  check("E) deleting a pinned copy removes it from the list", !(await api("GET", "/api/chats")).j.some((x) => x.id === f.j.id));

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
