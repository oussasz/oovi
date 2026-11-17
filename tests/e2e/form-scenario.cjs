// browser_steps (lib/tools.ts): a bot fills a whole form in ONE call in the bots' real browser (text fields,
// a dropdown, a box to tick, the send button), and sees what its action made appear marked NEW. Against the
// built oovi server with a scripted model and a page served here. Needs Chrome/Edge/Chromium like upload.
// Run: node tests/e2e/form-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-form-test");
const PORT = 3323;
const MODEL_PORT = 3393;
const SITE_PORT = 3390;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-form-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>Contact</title></head><body><h1>Contact</h1>
<label>Nom <input id="n" aria-label="Nom"></label>
<label>Email <input id="e" type="email" aria-label="Email"></label>
<label>Ville <select id="c" aria-label="Ville"><option value="">--</option><option value="alg">Alger</option><option value="orn">Oran</option></select></label>
<label><input id="a" type="checkbox" aria-label="J'accepte"> J'accepte</label>
<button id="go" onclick="document.getElementById('out').textContent='SENT: '+document.getElementById('n').value+'|'+document.getElementById('e').value+'|'+document.getElementById('c').selectedOptions[0].text+'|'+(document.getElementById('a').checked?'yes':'no');document.getElementById('thanks').style.display='inline'">Envoyer</button>
<p id="out">nothing yet</p><button id="thanks" style="display:none">Merci, voir ma demande</button></body></html>`;
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FORM);
}).listen(SITE_PORT, "127.0.0.1");

const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: {} };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const call = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${Date.now()}`, name, input }], "tool_use");
const seen = { calls: 0, out: "", tools: [] };

function answer(body) {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const out = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
  const prev = msgs[msgs.length - 2];
  const lastTool = results.length && prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
  if (!/FORM:/.test(JSON.stringify(msgs))) return text("ok");
  seen.calls++;
  seen.tools = (body.tools || []).map((t) => t.name);
  const num = (label) => Number((out.match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`)) || [])[1]);
  if (!lastTool) return call("open_url", { url: `${SITE}/contact` });
  if (lastTool === "open_url")
    return call("browser_steps", {
      steps: [
        { action: "type", element: num('"Nom"'), text: "Amina" },
        { action: "type", element: num('"Email"'), text: "amina@example.test" },
        { action: "type", element: num('"Ville"'), text: "Oran" },
        { action: "click", element: num("J'accepte") },
        { action: "click", element: num('"Envoyer"') },
      ],
    });
  seen.out = out;
  return text(`FORM-RESULT: ${out.replace(/\s+/g, " ").slice(0, 300)}`);
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
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      const rules = require("./model-rules.cjs");
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        const b = JSON.parse(raw);
        if (rules.refusal(b)) return send(400, { error: rules.refusal(b) });
        if (rules.isDoneCheck(b)) return send(200, rules.doneReply(b));
        return send(200, answer(b));
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
    return JSON.parse(t);
  } catch {
    return t;
  }
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
  await api("POST", "/api/settings", { browser: { allowPrivateNetwork: true }, approvals: { clicksAndTyping: false } });
  const bots = await api("GET", "/api/bots");
  const scout = bots.find((b) => b.name === "Scout");
  await api("PUT", `/api/bots/${scout.id}`, { ...scout, tools: { ...scout.tools, browser: true, web: true } });
  const dm = `dm-${scout.id}`;
  await fetch(`${BASE}/api/chats/${dm}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "FORM: fill in the contact form for Amina from Oran and send it" }) }).then((r) => r.text());
  for (let i = 0; i < 240 && (await api("GET", `/api/chats/${dm}`)).running; i++) await sleep(500);
  const c = await api("GET", `/api/chats/${dm}`);
  const last = c.entries.filter((e) => e.kind === "bot").at(-1);
  check("A) bots with a browser have browser_steps", seen.tools.includes("browser_steps"));
  check("A) the whole form was filled and sent in one call: text, email, dropdown, box, button", /SENT: Amina\|amina@example\.test\|Oran\|yes/.test(seen.out) && /Done, in order: type/.test(seen.out), seen.out.slice(0, 300));
  check("A) three model calls for the whole task (open, fill and send, answer), not one per field", seen.calls === 3, `${seen.calls} calls`);
  check("B) what the click made appear is marked NEW", /\[\d+\] NEW button "Merci, voir ma demande"/.test(seen.out), (seen.out.match(/INTERACTIVE ELEMENTS[^\n]*/) || [""])[0]);
  check("C) the bot answered", /FORM-RESULT/.test(last?.text || ""), last?.text?.slice(0, 120));
  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
