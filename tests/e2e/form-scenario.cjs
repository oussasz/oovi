// browser_steps (lib/tools.ts): a bot fills a whole form in ONE call in the bots' real browser (text fields,
// a dropdown, a box to tick, the send button), and sees what its action made appear marked NEW. Against the
// built oovi server with a scripted model and a page served here. Needs Chrome/Edge/Chromium like upload.
// Run: node tests/e2e/form-scenario.cjs
const http = require("node:http");
const allTools = require("./all-tools.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
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
const LOGIN = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body><h1>Sign in</h1>
<input id="u" type="email" aria-label="Email"><input id="p" type="password" aria-label="Password">
<button onclick="var ok=document.getElementById('p').value==='S3cret-Pass!42';document.getElementById('out').textContent=(ok?'WELCOME ':'WRONG ')+document.getElementById('u').value+' (typed: '+document.getElementById('p').value+')'">Sign in</button><p id="out">signed out</p></body></html>`;
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(req.url.startsWith("/login") ? LOGIN : FORM);
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
  if (/LOGIN:/.test(JSON.stringify(msgs))) {
    seen.loginBodies = [...(seen.loginBodies || []), JSON.stringify(body)];
    seen.loginTools = allTools(body).map((t) => t.name);
    if (!lastTool) return call("open_url", { url: `${SITE}/login` });
    if (lastTool === "open_url") return call("fill_login", {});
    if (lastTool === "fill_login") return call("click", { element: Number((out.match(/\[(\d+)\][^\n]*"Sign in"/) || [])[1]) });
    seen.loginOut = out;
    return text(`LOGIN-RESULT: ${out.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  const curUser = msgs.filter((m) => m.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && m.content.some((b) => b.type === "text")))).at(-1);
  if (/REPLAY:/.test(JSON.stringify(curUser || ""))) {
    seen.replayTools = allTools(body).map((t) => t.name);
    if (!lastTool) return call("replay_skill", { name: "Contact form", values: { Nom: "Sara" } });
    seen.replayOut = out;
    return text("REPLAY-DONE");
  }
  if (/SITE:/.test(JSON.stringify(msgs))) {
    // Two clicks on the same site: the first may ask, the second must not once the site is allowed.
    const from = msgs.map((m) => /SITE:/.test(JSON.stringify(m)) && m.role === "user").lastIndexOf(true);
    const n = msgs.slice(from).filter((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && b.name === "click")).length;
    const pick = (label) => Number((JSON.stringify(msgs).match(new RegExp(`\\[(\\d+)\\][^\\[]*${label}`)) || [])[1]);
    if (!lastTool && n === 0 && !msgs.slice(from).some((m) => m.role === "assistant")) return call("open_url", { url: `${SITE}/contact` });
    if (n === 0) return call("click", { element: pick("Nom") });
    if (n === 1) return call("click", { element: pick("Email") });
    return text(`SITE-DONE ${/declined/.test(out) ? "declined" : "ok"}`);
  }
  if (!/FORM:/.test(JSON.stringify(msgs))) return text("ok");
  seen.calls++;
  seen.tools = allTools(body).map((t) => t.name);
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
  // D: a saved login typed by oovi, never seen by the bot.
  const saved = await fetch(`${BASE}/api/logins`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: "127.0.0.1", username: "amina@example.test", password: "S3cret-Pass!42" }) });
  check("D) a login is saved (and listed without its password)", saved.status === 201 && !JSON.stringify(await api("GET", "/api/logins")).includes("S3cret"));
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: false } });
  const dm2 = `dm-${bots.find((b) => b.name === "Quill").id}`;
  const quill = bots.find((b) => b.name === "Quill");
  await api("PUT", `/api/bots/${quill.id}`, { ...quill, tools: { ...quill.tools, browser: true, web: true } });
  const runLogin = fetch(`${BASE}/api/chats/${dm2}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "LOGIN: sign in to my dashboard" }) }).then((r) => r.text());
  // The sign-in asks first, naming the site and the account.
  let card = null;
  for (let i = 0; i < 120 && !card; i++) {
    const c2 = await api("GET", `/api/chats/${dm2}`);
    card = c2.pending?.approval;
    if (!c2.running && !card) break;
    await sleep(500);
  }
  await runLogin;
  check("D) signing in asks first, naming the site and the account", !!card && /127\.0\.0\.1/.test(card.items[0].summary) && /amina@example\.test/.test(card.items[0].summary), card?.items?.[0]?.summary);
  if (card) {
    await fetch(`${BASE}/api/chats/${dm2}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisions: Object.fromEntries(card.items.map((it) => [it.call.id, true])) }) }).then((r) => r.text());
    for (let i = 0; i < 120 && (await api("GET", `/api/chats/${dm2}`)).running; i++) await sleep(500);
  }
  check("D) bots with a browser get fill_login once a login is saved", (seen.loginTools || []).includes("fill_login"));
  check("D) the site accepted the saved password typed by oovi", /WELCOME amina@example\.test/.test(seen.loginOut || ""), (seen.loginOut || "").match(/WELCOME[^\n]*|WRONG[^\n]*/)?.[0]);
  check("D) the password never reached the model, even when the page showed it back", !(seen.loginBodies || []).some((b) => b.includes("S3cret-Pass!42")) && /typed: ••••••/.test(seen.loginOut || ""));

  // E: teach by showing. The user takes Scout's browser (still on the form), records, works with mouse and
  // keyboard, and gets a skill draft with readable steps.
  const ctl = (action) => api("POST", "/api/browser/control", { chat: dm, bot: scout.id, action });
  const input = (events) => fetch(`${BASE}/api/browser/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: dm, bot: scout.id, events }) });
  check("E) recording needs control first", (await fetch(`${BASE}/api/browser/control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: dm, bot: scout.id, action: "record" }) })).status === 409);
  await ctl("take");
  const rec = await ctl("record");
  check("E) recording starts", rec.recording === true, JSON.stringify(rec));
  await input([{ type: "mouse", action: "down", x: 0.03, y: 0.04 }, { type: "mouse", action: "up", x: 0.03, y: 0.04 }]);
  await input([{ type: "key", key: "Tab" }, { type: "key", key: "Control+a" }, { type: "text", text: "Karim" }, { type: "key", key: "Tab" }, { type: "key", key: "Control+a" }, { type: "text", text: "karim@example.test" }]);
  await input([{ type: "key", key: "Enter" }]);
  const stop = await ctl("stopRecord");
  const steps = (stop.steps || []).join("\n");
  check("E) the steps read as a person would say them", /^1\. Open http:\/\/127\.0\.0\.1:\d+\//.test(steps) && /Click “Contact”/.test(steps) && /Type “Karim” in the “Nom” field/.test(steps) && /Type “karim@example\.test” in the “Email” field/.test(steps) && /Press Enter\./.test(steps), steps);
  check("E) a skill is drafted from them", /^Steps on 127\.0\.0\.1$/.test(stop.draft?.name || "") && /replay_skill/.test(stop.draft?.body || "") && Array.isArray(stop.draft?.replay) && stop.draft.replay.length > 3, JSON.stringify(stop.draft).slice(0, 160));
  check("E) recording stopped", !stop.recording && (await ctl("stopRecord")).error !== undefined);
  const made = await fetch(`${BASE}/api/skills`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...stop.draft, name: "Contact form" }) });
  check("E) the user saves it as a skill", made.status === 201 && (await api("GET", "/api/skills")).some((k) => k.name === "Contact form"));
  await ctl("release");
  check("E) the saved skill keeps the recorded steps", (await api("GET", "/api/skills")).some((k) => k.name === "Contact form" && k.replay === true));
  // G: the bot replays it by code, with another name typed in.
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: false } });
  await fetch(`${BASE}/api/chats/${dm}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "REPLAY: send the contact form again for Sara" }) }).then((r) => r.text());
  for (let i = 0; i < 240 && (await api("GET", `/api/chats/${dm}`)).running; i++) await sleep(250);
  check("G) bots with a browser get replay_skill", (seen.replayTools || []).includes("replay_skill"));
  check("G) the recorded steps ran by code, with the new value, in one call", /Replayed "Contact form": all \d+ steps done/.test(seen.replayOut || "") && /typed "Sara" in "Nom"/.test(seen.replayOut || ""), (seen.replayOut || "").slice(0, 300));

  // F: fewer approval cards. Clicks ask; "Allow for this chat" covers the site in that chat only;
  // "Always on this site" covers every chat; Settings lists the site.
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: true } });
  const runTo = async (chat, body) => {
    await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.text());
    for (let i = 0; i < 240; i++) {
      const c = await api("GET", `/api/chats/${chat}`);
      if (!c.running) return c;
      await sleep(250);
    }
  };
  const nova = bots.find((b) => b.name === "Nova");
  await api("PUT", `/api/bots/${nova.id}`, { ...nova, tools: { ...nova.tools, browser: true, web: true } });
  const dmN = `dm-${nova.id}`;
  let cn = await runTo(dmN, { text: "SITE: click the fields" });
  const card1 = cn.pending?.approval;
  check("F) a click asks, and the card offers this chat and this site", !!card1 && card1.items[0].scope?.key === "site:127.0.0.1", JSON.stringify(card1?.items?.[0]?.scope));
  cn = await runTo(dmN, { decisions: Object.fromEntries(card1.items.map((i) => [i.call.id, true])), allowChat: true });
  check("F) after Allow for this chat, the next click on that site doesn't ask", !cn.pending?.approval && /SITE-DONE ok/.test(cn.entries.filter((e) => e.kind === "bot").at(-1)?.text || "") && (cn.allow || []).includes("site:127.0.0.1"), JSON.stringify(cn.pending?.approval?.items?.map((i) => i.summary)));
  const chief = bots.find((b) => b.name === "Oovi") || bots.find((b) => ![scout.id, nova.id, quill.id].includes(b.id));
  await api("PUT", `/api/bots/${chief.id}`, { ...chief, tools: { ...chief.tools, browser: true, web: true } });
  const dmC = `dm-${chief.id}`;
  let cq = await runTo(dmC, { text: "SITE: click the fields" });
  const card2 = cq.pending?.approval;
  check("F) another chat still asks (that OK was for one chat)", !!card2);
  cq = await runTo(dmC, { decisions: Object.fromEntries(card2.items.map((i) => [i.call.id, true])), allowSite: true });
  const st = await api("GET", "/api/settings");
  check("F) Always on this site is saved in Settings", (st.approvals.sites || []).includes("127.0.0.1"), JSON.stringify(st.approvals) + " card2=" + JSON.stringify(card2.items.map((i) => i.scope)) + " allow=" + JSON.stringify(cq.allow));
  const dmS = dm; // Scout: a third chat, no card at all now
  const cs = await runTo(dmS, { text: "SITE: click the fields" });
  check("F) every chat now clicks on that site without a card", !cs.pending?.approval && /SITE-DONE ok/.test(cs.entries.filter((e) => e.kind === "bot").at(-1)?.text || ""));
  await api("POST", "/api/settings", { approvals: { sites: [] } });
  const cs2 = await runTo(dmS, { text: "SITE: click again" });
  check("F) removing the site in Settings brings the card back", !!cs2.pending?.approval);
  if (cs2.pending?.approval) await runTo(dmS, { decisions: Object.fromEntries(cs2.pending.approval.items.map((i) => [i.call.id, false])) });

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
