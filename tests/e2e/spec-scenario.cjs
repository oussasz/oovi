// End-to-end check of the specialist flow against the built oovi server, with a scripted
// stand-in for theOovi's model (port 3399; nothing leaves this machine):
// the group leader proposes a specialist -> a "Create" card waits -> the user creates it ->
// the new bot joins the group (hidden from the bots list) -> the leader hands it the work ->
// it replies -> the leader gives the final answer. Also: an invalid proposal (an existing
// role) never reaches the user, and a direct-chat proposal joins the group the Chief leads.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-spec-test");
const PORT = 3303;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-spec-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
const systemOf = (b) => (typeof b.system === "string" ? b.system : JSON.stringify(b.system || ""));
const seen = { tools: {}, systems: [] };
// Inside the user's home, as a real user's folders are (a Mac's temp folder is under /var, a system folder oovi refuses).
const HOME_TEST = path.join(os.homedir(), `oovi-spec-${process.pid}`);
const PROJECT = path.join(HOME_TEST, "project", "shop");
const SAVE_DIR = path.join(HOME_TEST, "save");

function answer(body) {
  const tools = (body.tools || []).map((t) => t.name || t.type);
  const sys = systemOf(body);
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const all = msgs.map(textOf).join(" ");
  const me = (sys.match(/You are (\w+)/) || [])[1] || "?";
  seen.tools[me] = tools;
  seen.systems.push({ me, collab: /work with it, not alone/.test(sys), language: /language of the user's latest message/.test(sys) });
  // Coder: files of a project go in the folder the user names; long documents in parts; a cut-off answer runs nothing.
  if (me === "Coder") {
    seen.coderSys = sys;
    const latest = (() => {
      for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user" && textOf(msgs[i]).trim()) return i;
      return 0;
    })();
    const after = msgs.slice(latest);
    const n = after.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").length : 0), 0);
    const ask = textOf(msgs[latest]);
    const out = results[0] ? (typeof results[0].content === "string" ? results[0].content : JSON.stringify(results[0].content)) : "";
    const use = (name, input, stop = "tool_use") => reply([{ type: "tool_use", id: `toolu_${name}_${Date.now()}_${n}`, name, input }], stop);
    if (/FILES:/.test(ask)) {
      seen.files = seen.files || {};
      if (n) seen.files[n] = out;
      seen.filesTools = tools;
      if (n === 0) return use("create_document", { filename: "app.py", content: "print(1)" });
      if (n === 1) return use("use_project_folder", { path: PROJECT, why: "To create the app files you asked for." });
      if (n === 2) return use("write_file", { path: "app.py", content: "print('hi')\n" });
      return reply([{ type: "text", text: "FILES-DONE" }], "end_turn");
    }
    if (/LONGDOC:/.test(ask)) {
      seen.doc = seen.doc || {};
      if (n) seen.doc[n] = out;
      if (n === 0) return use("create_document", { filename: "Rapport.md", title: "Rapport", content: "## Partie 1\nAAA" });
      if (n === 1) return use("create_document", { filename: "Rapport.md", append: true, content: "## Partie 2\nBBB" });
      return reply([{ type: "text", text: "DOC-DONE" }], "end_turn");
    }
    if (/CUT:/.test(ask)) {
      if (n === 0) return use("create_document", { filename: "Long.docx", content: "Only the first half of a long rep" }, "max_tokens");
      seen.cut = out;
      return reply([{ type: "text", text: "CUT-SEEN" }], "end_turn");
    }
    if (/SAVEHERE:/.test(ask)) {
      if (n === 0) return use("create_document", { filename: "Note.txt", content: "saved where the user chose" });
      seen.saved = out;
      return reply([{ type: "text", text: "SAVE-DONE" }], "end_turn");
    }
    return reply([{ type: "text", text: "ok" }], "end_turn");
  }
  if (me === "Lina") return reply([{ type: "text", text: "LINA-POST: ☕ Nouveau menu chez Café Zitouna !" }], "end_turn");
  if (!tools.includes("propose_specialist")) return reply([{ type: "text", text: "ok" }], "end_turn");
  const r = results[0] ? JSON.stringify(results[0].content) : "";
  // The Chief in its direct chat: propose a specialist for its group.
  if (!/SPECIALIST|DUPLICATE/.test(all) && /DIRECT/.test(all)) {
    if (results.length) return reply([{ type: "text", text: `CHIEF-DONE: ${r.slice(0, 120)}` }], "end_turn");
    return reply([{ type: "tool_use", id: `toolu_sp_${Date.now()}`, name: "propose_specialist", input: { name: "Tarik", role: "Translator", instructions: "You are a translator between French, Arabic and English. Keep the tone, adapt idioms, and return only the translation.", why: "No one on the team translates." } }], "tool_use");
  }
  if (/DUPLICATE/.test(all)) {
    if (results.length) return reply([{ type: "text", text: `DUP-RESULT: ${r.slice(0, 160)}` }], "end_turn");
    return reply([{ type: "tool_use", id: `toolu_dup_${Date.now()}`, name: "propose_specialist", input: { name: "Scribe", role: "Writer", instructions: "You are another writer who writes posts, articles and emails with a clear structure.", why: "More writing." } }], "tool_use");
  }
  // Group leader: propose, then delegate to the new specialist, then wrap up.
  if (/LINA-POST/.test(all)) return reply([{ type: "text", text: "FINAL: Lina wrote the post." }], "end_turn");
  if (results.length && /Created @Lina/.test(r)) return reply([{ type: "text", text: "@Lina please write the Facebook post for Café Zitouna's new menu." }], "end_turn");
  if (results.length) return reply([{ type: "text", text: `LEADER-AFTER: ${r.slice(0, 120)}` }], "end_turn");
  return reply(
    [
      { type: "text", text: "The team has no social media copywriter." },
      { type: "tool_use", id: `toolu_sp_${Date.now()}`, name: "propose_specialist", input: { name: "Lina", role: "Social media copywriter", instructions: "You are a social media copywriter for small businesses. Write short, warm posts in French and Arabic with emojis and a clear call to action.", why: "Nobody on the team writes social media posts." } },
    ],
    "tool_use",
  );
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
      // Sign-up with email confirmation (the account service asks for the 6-digit code first).
      if (url === "/api/v1/auth/sign-up" && req.method === "POST") return send(201, { verify: true, email: JSON.parse(raw).email });
      if (url === "/api/v1/auth/resend-code" && req.method === "POST") {
        seen.resent = (seen.resent || 0) + 1;
        return send(204);
      }
      if (url === "/api/v1/auth/verify-email" && req.method === "POST") {
        const b = JSON.parse(raw);
        if (b.code !== "123456") return send(400, { error: "That code isn't right. Check the latest email from oovi." });
        return send(200, { token: "verified-token", user: { id: "new1", email: b.email, name: "Nadia", image: null } });
      }
      if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Phase Tester", image: null } });
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
      if (url === "/api/v1/catalog") return send(200, { items: [] });
      return send(204);
    });
  })
  .listen(3399, "127.0.0.1");

let server = null;
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: "http://127.0.0.1:3399", PORT: String(PORT) },
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
async function idle(chatId, ms = 30000) {
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

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  const bots = await api("GET", "/api/bots");
  const [chief, scout, quill] = bots;
  await api("POST", "/api/main", { botId: chief.id });
  const group = await api("POST", "/api/chats", { name: "Studio Test", memberIds: [chief.id, scout.id, quill.id], leadId: chief.id });
  log(`chief ${chief.name}, group ${group.name}; roles: ${bots.map((b) => `${b.name}=${b.role}`).join(", ")}`);

  // 1. The leader proposes a specialist: a Create card waits for the user.
  await api("POST", `/api/chats/${group.id}/run`, { text: "SPECIALIST: write a Facebook post for my café's new menu" });
  let g = await idle(group.id);
  const item = g.pending?.approval?.items?.[0];
  check("the leader is told to work as a team and to reply in the user's language", seen.systems.some((s) => s.collab && s.language));
  check("a specialist card waits for the user", !!item?.specialist && item.specialist.name === "Lina", item ? `${item.summary} | why: ${item.specialist?.why}` : "no approval");
  check("the card shows a face and the group it joins", !!item?.specialist?.face && item.specialist.group === "Studio Test");
  check("nothing is created before the user clicks Create", !(await api("GET", "/api/bots")).some((b) => b.name === "Lina"));

  // 2. The user clicks Create: Lina joins, the leader hands her the post, she writes it, the leader finishes.
  await api("POST", `/api/chats/${group.id}/run`, { decisions: { [item.call.id]: true } });
  g = await idle(group.id);
  const lina = (await api("GET", "/api/bots")).find((b) => b.name === "Lina");
  check("Create made the bot, with the card's face", !!lina && JSON.stringify(lina.face) === JSON.stringify(item.specialist.face));
  check("it's hidden from the bots list", lina?.hidden === true);
  check("it joined the group", g.memberIds.includes(lina?.id));
  const texts = g.entries.filter((e) => e.kind === "bot").map((e) => e.text);
  check("the leader handed it the work in the same run, and it replied", texts.some((t) => t.startsWith("LINA-POST")), texts.join(" | ").slice(0, 200));
  check("the leader gave the final answer", texts.at(-1) === "FINAL: Lina wrote the post.");

  // 3. Proposing a role the team already has never reaches the user.
  await api("POST", `/api/chats/${group.id}/run`, { text: "DUPLICATE: we need more writing" });
  g = await idle(group.id);
  const dup = g.entries.filter((e) => e.kind === "bot").at(-1)?.text ?? "";
  check("a duplicate role is refused without asking the user", !g.pending?.approval && /already is the team's/.test(dup), dup.slice(0, 160));

  // 4. Proposing an existing bot's name again is refused too.
  await api("PUT", `/api/chats/${group.id}`, { clear: true });
  await api("POST", `/api/chats/${group.id}/run`, { text: "SPECIALIST: another post" });
  g = await idle(group.id);
  const item2 = g.pending?.approval?.items?.[0];
  check("proposing an existing bot's name is refused", !item2, g.entries.filter((e) => e.kind === "bot").at(-1)?.text?.slice(0, 120));

  // 5. From the Chief's direct chat: the specialist joins the group the Chief leads.
  await api("POST", `/api/chats/dm-${chief.id}/run`, { text: "DIRECT: I need translations" });
  let dm = await idle(`dm-${chief.id}`);
  const item3 = dm.pending?.approval?.items?.[0];
  check("the Chief can propose from its direct chat", item3?.specialist?.name === "Tarik" && item3.specialist.group === "Studio Test");
  await api("POST", `/api/chats/dm-${chief.id}/run`, { decisions: { [item3.call.id]: false } });
  dm = await idle(`dm-${chief.id}`);
  check("Not now creates nothing", !(await api("GET", "/api/bots")).some((b) => b.name === "Tarik"));
  await api("POST", `/api/chats/dm-${chief.id}/run`, { text: "DIRECT: translations please" });
  dm = await idle(`dm-${chief.id}`);
  const item4 = dm.pending?.approval?.items?.[0];
  await api("POST", `/api/chats/dm-${chief.id}/run`, { decisions: { [item4.call.id]: true } });
  dm = await idle(`dm-${chief.id}`);
  const tarik = (await api("GET", "/api/bots")).find((b) => b.name === "Tarik");
  const g5 = await api("GET", `/api/chats/${group.id}`);
  check("created from the direct chat, it joins the Chief's group", !!tarik && g5.memberIds.includes(tarik.id) && tarik.hidden === true);

  // Email confirmed while the account is being opened, not after the first message.
  const su = await api("POST", "/api/account", { action: "signup", name: "Nadia", email: "nadia@example.test", password: "a-long-password", acceptTerms: true });
  check("a new account asks for the 6-digit email code before it opens", su.verify?.email === "nadia@example.test", JSON.stringify(su).slice(0, 160));
  const bad = await api("POST", "/api/account", { action: "verify", email: "nadia@example.test", code: "000000" });
  check("a wrong code says so plainly", /That code isn't right/.test(bad.error || ""), JSON.stringify(bad).slice(0, 160));
  const again = await api("POST", "/api/account", { action: "resend", email: "nadia@example.test" });
  check("a new code can be asked for", again.sent === true && seen.resent === 1);
  const ok = await api("POST", "/api/account", { action: "verify", email: "nadia@example.test", code: "123456" });
  check("the right code opens the account (signed in as the new user)", ok.loggedIn === true && ok.user?.email === "nadia@example.test", JSON.stringify(ok).slice(0, 160));

  // Files: code goes in the folder the user names (asked on a card), long documents in parts, cut-off calls run nothing.
  fs.rmSync(path.dirname(PROJECT), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(PROJECT), { recursive: true });
  const coder = await api("POST", "/api/bots", { name: "Coder", role: "Back-end developer who ships small Python apps for shops", about: "I don't write all the code. I decide who suffers writing it.", instructions: "You are Coder.", face: tarik.face, tools: { web: false, browser: false } });
  check("a longer role and a role description are kept", coder.role === "Back-end developer who ships small Python apps for shops" && coder.about === "I don't write all the code. I decide who suffers writing it.", `${coder.role} | ${coder.about}`);
  const cd = `dm-${coder.id}`;
  await api("POST", `/api/chats/${cd}/run`, { text: "FILES: make me a small Flask app in my shop folder" });
  let cc = await idle(cd);
  check("the bot is told its role description", /How the user describes your role[^\n]*I decide who suffers writing it/.test(seen.coderSys || ""));
  check("a code file isn't made as a 'document': the bot is pointed to the project folder", /not \.py/.test(seen.files?.[1] || "") && /use_project_folder/.test(seen.files?.[1] || ""), (seen.files?.[1] || "").slice(0, 200));
  const fcard = cc.pending?.approval?.items?.[0];
  check("asking to work in a folder shows a card naming it, and that it will be created", !!fcard && fcard.summary.includes(PROJECT) && /will be created/.test(fcard.detail || ""), `${fcard?.summary} | ${(fcard?.detail || "").slice(0, 120)}`);
  await api("POST", `/api/chats/${cd}/run`, { decisions: { [fcard.call.id]: true } });
  cc = await idle(cd);
  const wcard = cc.pending?.approval?.items?.[0];
  check("once allowed, the chat has that project folder and the bot gets write_file", cc.workspace?.path === PROJECT && fs.existsSync(PROJECT) && (seen.filesTools || []).includes("write_file") && !!wcard, `${cc.workspace?.path} | ${wcard?.summary}`);
  if (wcard) {
    await api("POST", `/api/chats/${cd}/run`, { decisions: { [wcard.call.id]: true } });
    cc = await idle(cd);
  }
  check("the code file is written in the user's folder, nowhere else", fs.existsSync(path.join(PROJECT, "app.py")) && fs.readFileSync(path.join(PROJECT, "app.py"), "utf8") === "print('hi')\n" && cc.entries.at(-1)?.text === "FILES-DONE", cc.entries.at(-1)?.text);
  await api("PUT", `/api/chats/${cd}`, { workspace: null });

  await api("POST", `/api/chats/${cd}/run`, { text: "LONGDOC: write the long report" });
  await idle(cd);
  const where = (seen.doc?.[2] || "").match(/Added to (.+?\.md)/)?.[1] || "";
  const md = where && fs.existsSync(where) ? fs.readFileSync(where, "utf8") : "";
  check("a long document is written in parts: the second part is added to the same file", /^# Rapport\n\n## Partie 1\nAAA\n\n## Partie 2\nBBB/.test(md) && !fs.existsSync(where.replace(/\.md$/, " (2).md")), `${where} | ${JSON.stringify(md).slice(0, 120)}`);
  check("the bot is told how big the document is now and how to add more", /now has 6 words in 2 headed sections\. To add more sections, call create_document again with this filename and append: true/.test(seen.doc?.[2] || ""), (seen.doc?.[2] || "").slice(0, 200));

  await api("POST", `/api/chats/${cd}/run`, { text: "CUT: write a very long report" });
  await idle(cd);
  const dl = where ? path.dirname(where) : "";
  check("a call cut at the length limit isn't run (no half file) and the bot is told to send less per call", /reached the length limit for one answer/.test(seen.cut || "") && /append: true/.test(seen.cut || "") && !!dl && !fs.readdirSync(dl).some((f) => f.startsWith("Long")), (seen.cut || "").slice(0, 160));

  fs.rmSync(SAVE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const sv = await api("POST", "/api/computer-files", { saveFolder: SAVE_DIR });
  check("the user can choose where bots save their files", sv.custom === true && sv.saveFolder === fs.realpathSync(SAVE_DIR), JSON.stringify(sv).slice(0, 200));
  await api("POST", `/api/chats/${cd}/run`, { text: "SAVEHERE: save a note" });
  await idle(cd);
  check("files bots make go to the chosen folder", fs.existsSync(path.join(fs.realpathSync(SAVE_DIR), "Note.txt")), (seen.saved || "").slice(0, 160));
  const back = await api("POST", "/api/computer-files", { saveFolder: null });
  check("and back to the default folder", back.custom === false && back.saveFolder === back.saveDefault, JSON.stringify(back).slice(0, 200));

  fs.rmSync(HOME_TEST, { recursive: true, force: true });
  log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
