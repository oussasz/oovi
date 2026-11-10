// End-to-end replay of a real conversation that went wrong, against the built oovi server, with a
// scripted stand-in for theOovi's model (port 3396; nothing leaves this machine). What happened then:
// the Chief asked a group without a leader (c, mouloud) for a dashboard link; c posted it, then c and
// mouloud passed the turn back and forth agreeing with each other, mouloud spoke last, and the Chief
// told the user "c didn't answer". Checked here:
//   A) the Chief gets the link even though another bot spoke last,
//   B) agreeing / thanking / referring to a teammate doesn't pass the turn (no ping-pong),
//   C) a leader's "Great work @Scout!" in its final answer doesn't send Scout back to work,
//   D) the prompts carry the short-message, @-mention and language rules.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-group-test");
const PORT = 3305;
const MODEL_PORT = 3396;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-group-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LINK = "https://profiles-test-dashboard.trycloudflare.com";
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const textOf = (m) => (Array.isArray(m.content) ? m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? JSON.stringify(b.content) : "")).join(" ") : String(m.content || ""));
const systemOf = (b) => (typeof b.system === "string" ? b.system : JSON.stringify(b.system || ""));

const seen = { systems: {}, tools: {}, chiefResult: "", turns: {} };

function answer(body) {
  const sys = systemOf(body);
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const all = msgs.map(textOf).join(" ");
  const me = (sys.match(/You are (\w+)/) || [])[1] || "?";
  seen.systems[me] = sys;
  seen.tools[me] = body.tools || [];
  const mgSpec = (body.tools || []).find((t) => t.name === "message_group");
  if (mgSpec) seen.messageGroup = mgSpec;
  seen.turns[me] = (seen.turns[me] || 0) + 1;

  // The Chief, in its direct chat: ask the group, then report what came back.
  if (me === "Oovi" && /DASH:/.test(all) && (body.tools || []).some((t) => t.name === "message_group")) {
    if (results.length) {
      seen.chiefResult = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
      return text(`CHIEF-SAW: ${seen.chiefResult.includes(LINK) ? "the link" : "no link"}`);
    }
    return reply([{ type: "tool_use", id: `toolu_mg_${Date.now()}`, name: "message_group", input: { group: "Business", message: "@c please send the Business OS dashboard link." } }], "tool_use");
  }
  // The group without a leader, as it went that day.
  if (me === "c") {
    if (/mouloud\]: /.test(all)) return text("Merci @mouloud, ta correction est juste. @mouloud a raison : relance le Business OS."); // would bounce back before the fix
    return text(`Voici le lien du Business OS : ${LINK}\nCorrection : la deadline de m3ak est le 12 nov, pas demain comme l'a écrit @mouloud.\n@mouloud, peux-tu vérifier que le lien s'ouvre ?`);
  }
  if (me === "mouloud") return text("Marys, le dashboard s'ouvre vide. @c a raison : il faut relancer le Business OS. Merci @c.");
  // A group with a leader: one hand-off, then a final answer that thanks the teammate.
  if (me === "Oovi" && /TEAM:/.test(all)) {
    if (/PRICES:/.test(all)) return text("Great work @Scout! Final: three cafés nearby, 150-300 DA.");
    return text("@Scout please list the cafés near us and their prices.");
  }
  if (me === "Scout") return text("PRICES: three cafés nearby, 150-300 DA.");
  return text("ok");
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
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Marys", image: null } });
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        try {
          return send(200, answer(JSON.parse(raw)));
        } catch (e) {
          return send(400, { error: String(e) });
        }
      }
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

let server = null;
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: `http://127.0.0.1:${MODEL_PORT}`, PORT: String(PORT) },
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
      if ((await fetch(`${BASE}/api/bots`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("server didn't start");
}
async function idle(chatId, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const c = await api("GET", `/api/chats/${chatId}`);
    if (!c.running) return c;
    await sleep(300);
  }
  throw new Error(`chat ${chatId} still running`);
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const face = { color: 1, shape: 0, hair: 0, eyes: 0, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 };
const newBot = (name, role) => api("POST", "/api/bots", { name, role, instructions: `You are ${name}, a helpful teammate for the user's small business.`, face, tools: { web: false, browser: false } });

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  const bots = await api("GET", "/api/bots");
  const chief = bots[0];
  const scout = bots.find((b) => b.name === "Scout");
  await api("POST", "/api/main", { botId: chief.id });
  const c = await newBot("c", "Business analyst");
  const mouloud = await newBot("mouloud", "Personal assistant");
  const biz = await api("POST", "/api/chats", { name: "Business", memberIds: [c.id, mouloud.id], orchestrate: false });
  log(`chief ${chief.name}; group ${biz.name} (no leader): ${c.name}, ${mouloud.name}`);

  // A + B: the Chief asks the group for the link.
  await api("POST", `/api/chats/dm-${chief.id}/run`, { text: "DASH: ask @c for my dashboard link" });
  await idle(`dm-${chief.id}`);
  const g = await idle(biz.id);
  const said = g.entries.filter((e) => e.kind === "bot").map((e) => `${e.botId === c.id ? "c" : "mouloud"}: ${e.text.slice(0, 60)}`);
  check("c and mouloud don't bounce agreement back and forth (2 messages, not 5)", said.length === 2, said.join(" | "));
  check("c's link reaches the Chief although mouloud spoke last", seen.chiefResult.includes(LINK) && /Earlier messages in the group/.test(seen.chiefResult));
  const dm = await api("GET", `/api/chats/dm-${chief.id}`);
  check("the Chief reports the link instead of 'c didn't answer'", dm.entries.at(-1)?.text === "CHIEF-SAW: the link", dm.entries.at(-1)?.text);

  // C: a led group; the leader's thank-you mention doesn't send Scout back to work.
  const team = await api("POST", "/api/chats", { name: "Team", memberIds: [chief.id, scout.id], leadId: chief.id });
  const scoutTurns = seen.turns.Scout || 0;
  await api("POST", `/api/chats/${team.id}/run`, { text: "TEAM: compare café prices near us" });
  const t = await idle(team.id);
  const tb = t.entries.filter((e) => e.kind === "bot");
  check("the leader hands out work once and its 'Great work @Scout!' ends the task", (seen.turns.Scout || 0) - scoutTurns === 1 && tb.length === 3 && /^Great work/.test(tb.at(-1)?.text ?? ""), tb.map((e) => e.text.slice(0, 40)).join(" | "));

  // D: the rules are in the prompts.
  check("group members are told to keep messages short and not repeat", /Group messages are short/.test(seen.systems.c || "") && /without @/.test(seen.systems.c || ""));
  check("every bot is told: answer first, a few lines", /Be short and practical/.test(seen.systems.Oovi || ""));
  const mg = seen.messageGroup;
  check("the Chief writes to groups in the user's language", /language of the user's latest message/.test(mg?.description || ""));

  const ok = results.filter((r) => r.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
