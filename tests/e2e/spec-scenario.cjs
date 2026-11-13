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

  log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
