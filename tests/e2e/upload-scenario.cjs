// A bot attaches a real file from the user's computer to a real web page, in the bots' real browser,
// against the built oovi server with a scripted stand-in for theOovi's model (nothing leaves this
// machine: the pages are served here). The owner's case: "put this file in the dashboard's import
// field" was answered with "I can't choose a local file: do it yourself in 3 steps".
// Checked here:
//   A) a visible file field: the file is attached, then the page's own button adds it,
//   B) an email-style "Attach" button that opens the file chooser (the file field is hidden),
//   C) a page with two file fields asks which one instead of guessing,
//   D) a file outside Downloads/oovi asks the user first, on a card naming the file and the site,
//   E) keys and system files are never attached, even with the user's OK,
//   F) every bot with a browser is told to attach files itself, never to ask the user to pick one.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-upload-test");
const PORT = 3314;
const MODEL_PORT = 3392;
const SITE_PORT = 3391;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-upload-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the "dashboard" and the "webmail" ----
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
const SHOW = `<p id="out">nothing yet</p><script>function show(input,word){const f=input.files[0];document.getElementById("out").textContent=f?word+": "+f.name+" ("+f.size+" bytes)":"no file";}</script>`;
const PAGES = {
  "/import": page("Dashboard import", `<p>Project: m3ak</p><input type="file" id="f" aria-label="Fichier Word / Excel"><button onclick="show(document.getElementById('f'),'ADDED')">Ajouter</button>${SHOW}`),
  "/mail": page("Webmail", `<p>New message to client@example.test</p><input type="file" id="f" style="display:none" onchange="show(this,'ATTACHED')"><button onclick="document.getElementById('f').click()">Attach a file</button><button>Send</button>${SHOW}`),
  "/two": page("Two fields", `<input type="file" id="a" style="display:none"><input type="file" id="b" style="display:none"><p>Identity card and invoice</p>${SHOW}`),
};
http.createServer((req, res) => {
  const body = PAGES[req.url.split("?")[0]];
  res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(body || "not found");
}).listen(SITE_PORT, "127.0.0.1");

// ---- the scripted model ----
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 } };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const call = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, input }], "tool_use");
const systemOf = (b) => (typeof b.system === "string" ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("\n") : "");
const seen = { system: "", tools: [] };
const FILE = path.join(DATA, "downloads", "Prospects Alger - m3ak (fusion).xlsx");
const OUTSIDE = path.join(os.tmpdir(), "oovi-upload-outside", "Contrat client.pdf");
const KEY = path.join(os.homedir(), ".ssh", "id_rsa");

function answer(body) {
  const sys = systemOf(body);
  if (/learn from finished work/.test(sys)) return text('{"lessons":[],"user":[],"tools":[],"skill":null}');
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const out = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
  const prev = msgs[msgs.length - 2];
  const lastTool = results.length && prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
  const all = JSON.stringify(msgs);
  const scene = (all.match(/(IMPORT|MAIL|TWO|OUTSIDE|KEY):(?![\s\S]*(?:IMPORT|MAIL|TWO|OUTSIDE|KEY):)/) || [])[1] || "";
  seen.system = sys;
  seen.tools = (body.tools || []).map((t) => t.name);
  const numberOf = (label) => Number((out.match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`)) || [])[1]);
  const pageUrl = { IMPORT: "/import", MAIL: "/mail", TWO: "/two", OUTSIDE: "/import", KEY: "/import" }[scene];
  if (!scene) return text("ok");
  if (!lastTool) return call("open_url", { url: SITE + pageUrl });
  if (lastTool === "open_url") {
    seen[`${scene}:page`] = out;
    if (scene === "MAIL") return call("upload_file", { path: FILE, element: numberOf("Attach a file") });
    return call("upload_file", { path: scene === "OUTSIDE" ? OUTSIDE : scene === "KEY" ? KEY : FILE });
  }
  if (lastTool === "upload_file") {
    seen[`${scene}:upload`] = out;
    if (scene === "IMPORT" && !/declined|not found|Blocked/i.test(out)) return call("click", { element: numberOf("Ajouter") });
    return text(`${scene}-RESULT: ${out.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  if (lastTool === "click") return text(`${scene}-RESULT: ${out.replace(/\s+/g, " ").slice(0, 400)}`);
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
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      const refused = url === "/api/v1/ai/messages" && req.method === "POST" ? require("./model-rules.cjs").refusal(JSON.parse(raw)) : null;
      if (refused) return send(400, { error: refused });
      if (url === "/api/v1/ai/messages" && req.method === "POST" && require("./model-rules.cjs").isDoneCheck(JSON.parse(raw))) return send(200, require("./model-rules.cjs").doneReply(JSON.parse(raw)));
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        try {
          return send(200, answer(JSON.parse(raw)));
        } catch (e) {
          return send(400, { error: String(e) });
        }
      }
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
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, Buffer.alloc(11_264, 7)); // an 11 KB "Excel file" the bots made earlier
  fs.mkdirSync(path.dirname(OUTSIDE), { recursive: true });
  fs.writeFileSync(OUTSIDE, Buffer.alloc(2048, 3));
  startServer();
  await waitReady();
  // The test pages are on this machine: let the bots' browser reach them.
  await api("POST", "/api/settings", { browser: { allowPrivateNetwork: true } });
  const bots = await api("GET", "/api/bots");
  const scout = bots.find((b) => b.name === "Scout");
  const chat = `dm-${scout.id}`;
  /** Send a message, answer every approval card with `ok`, and return the chat when it is done. */
  async function run(textIn, ok = true) {
    const cards = [];
    await api("POST", `/api/chats/${chat}/run`, { text: textIn });
    for (let i = 0; i < 12; i++) {
      const c = await api("GET", `/api/chats/${chat}`);
      if (c.running) {
        await sleep(300);
        continue;
      }
      const ap = c.pending?.approval;
      if (!ap) return { chat: c, cards };
      cards.push(ap.items.map((it) => it.summary).join(" + "));
      await api("POST", `/api/chats/${chat}/run`, { decisions: Object.fromEntries(ap.items.map((it) => [it.call.id, ok])) });
    }
    throw new Error("too many approval cards");
  }
  const lastText = (r) => r.chat.entries.filter((e) => e.kind === "bot").at(-1)?.text ?? "";

  // A: the owner's case.
  let r = await run("IMPORT: put the prospects file in the dashboard's import field");
  check("A) the file is attached to a visible file field, and the page's own button adds it", /IMPORT-RESULT:.*ADDED: Prospects Alger - m3ak \(fusion\)\.xlsx \(11264 bytes\)/.test(lastText(r)), lastText(r).slice(0, 220));
  check("A) the bot is told the file is attached but not sent yet", /Attached Prospects Alger - m3ak \(fusion\)\.xlsx \(11 KB\) to the page\. It isn't sent yet/.test(seen["IMPORT:upload"] || ""), (seen["IMPORT:upload"] || "").slice(0, 120));
  check("A) with 'ask before clicks and typing' on, the card names the file and the site", r.cards.some((c) => /Attach .*Prospects Alger - m3ak \(fusion\)\.xlsx to the page on 127\.0\.0\.1:3391/.test(c)), r.cards.join(" | ").slice(0, 200));

  // B: an email-style Attach button.
  r = await run("MAIL: attach the prospects file to my email");
  check("B) a button that opens the file chooser gets the file (the file field is hidden)", /ATTACHED: Prospects Alger - m3ak \(fusion\)\.xlsx \(11264 bytes\)/.test(seen["MAIL:upload"] || ""), (seen["MAIL:upload"] || "").replace(/\s+/g, " ").slice(-200));

  // C: two fields.
  r = await run("TWO: upload the prospects file");
  check("C) two file fields: the bot is asked which one, nothing is attached by guess", /This page has 2 file fields\. Call upload_file again with the number/.test(lastText(r)), lastText(r).slice(0, 200));

  // D: a file outside Downloads/oovi, with "ask before clicks and typing" switched off.
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: false } });
  r = await run("OUTSIDE: attach the client contract", false);
  check("D) a file outside Downloads/oovi always asks first, even with other approvals off", r.cards.length === 1 && /Contrat client\.pdf/.test(r.cards[0]) && /declined/i.test(lastText(r)), `${r.cards.join(" | ")} || ${lastText(r).slice(0, 120)}`);
  r = await run("OUTSIDE: attach the client contract", true);
  check("D) once allowed, it is attached", /OUTSIDE-RESULT: Attached Contrat client\.pdf \(2 KB\)/.test(lastText(r)), lastText(r).slice(0, 160));
  r = await run("IMPORT: put the prospects file in the dashboard's import field");
  check("D) a file the bots made (Downloads/oovi) needs no card when approvals are off", r.cards.length === 0 && /ADDED: Prospects Alger/.test(lastText(r)), `${r.cards.length} cards`);

  // E: secrets.
  r = await run("KEY: upload my ssh key");
  check("E) a key file is never attached, and no card is shown for it", r.cards.length === 0 && /KEY-RESULT: Blocked: .*id_rsa is in /.test(lastText(r)), lastText(r).slice(0, 200));

  // F: instructions.
  check("F) bots with a browser have the tool and are told never to make the user pick the file", seen.tools.includes("upload_file") && /Never tell the user to choose the file themselves/.test(seen.system));

  const ok = results.filter((x) => x.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
