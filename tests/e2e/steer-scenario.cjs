// Writing to a bot while it works (lib/steer.ts): the message is accepted (202, not 409), the working bot
// reads it before its next step, the conversation stays valid for the model, and a message sent just before
// Stop starts the next run ("stop, then correct"). Scripted model, nothing leaves this machine.
// Run: node tests/e2e/steer-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-steer-test");
const PORT = 3321;
const MODEL_PORT = 3398;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-steer-log.txt");
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
const seen = { bodies: [], slow: 900 };

function answer(body) {
  const msgs = body.messages || [];
  const all = msgs.map(textOf).join("\n");
  seen.bodies.push(body);
  const uses = msgs.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").length : 0), 0);
  const use = (n) => reply([{ type: "tool_use", id: `toolu_${n}_${Date.now()}`, name: "work_notes", input: { action: "append", file: "Steps", text: `step ${n}` } }], "tool_use");
  if (/STEER-A/.test(all)) {
    if (/CHANGE-PLAN/.test(all)) return reply([{ type: "text", text: "STEER-DONE: changed the plan as you asked." }], "end_turn");
    if (uses < 6) return use(uses);
    return reply([{ type: "text", text: "STEER-DONE: no change seen." }], "end_turn");
  }
  if (/STOP-B/.test(all)) {
    if (/CORRECTION-C/.test(all.split("STOP-B").pop())) return reply([{ type: "text", text: "CORRECTED: on it with your correction." }], "end_turn");
    return use(uses);
  }
  return reply([{ type: "text", text: "ok" }], "end_turn");
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
        if (/You keep the running memory of a conversation/.test(sysText)) {
          seen.summaries = [...(seen.summaries || []), Date.now()];
          return send(200, reply([{ type: "text", text: "SUMMARY: the user sent long notes." }], "end_turn"));
        }
        await sleep(seen.slow);
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

  // A: a message during the work is read at the next step.
  const start = fetch(`${BASE}/api/chats/${dm}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "STEER-A: write the steps one by one" }) }).then((r) => r.text());
  await sleep(1500);
  const q = await api("POST", `/api/chats/${dm}/run`, { text: "CHANGE-PLAN: do it differently", entryId: "msteer1" });
  check("A) a message sent while the bot works is accepted (202), not refused", q.status === 202 && q.j.queued === true, `${q.status} ${JSON.stringify(q.j)}`);
  await start;
  let c = await idle();
  const users = c.entries.filter((e) => e.kind === "user");
  const last = c.entries.filter((e) => e.kind === "bot").at(-1);
  check("A) the working bot read it at its next step and answered it in the same run", /STEER-DONE: changed/.test(last?.text || "") && c.entries.filter((e) => e.kind === "bot").length === 1, last?.text);
  check("A) it is saved in the conversation with the id the screen gave it, marked as written during the work", users.some((u) => u.id === "msteer1" && u.steer === true && u.text === "CHANGE-PLAN: do it differently"));
  const withSteer = seen.bodies.find((b) => (b.messages || []).some((m) => /CHANGE-PLAN/.test(textOf(m))));
  check("A) the bot is told it was written during the work", !!withSteer && (withSteer.messages || []).some((m) => /wrote this while you were working/.test(textOf(m))));
  check("A) the conversation stayed valid for the model (alternating roles, ends with the user)", !seen.refused, seen.refused || "");

  // B: a message sent, then Stop: the message starts the next run (another bot's chat: a clean conversation).
  seen.bodies = [];
  const dmB = `dm-${bots.find((b) => b.name === "Quill").id}`;
  const startB = fetch(`${BASE}/api/chats/${dmB}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "STOP-B: go on step by step" }) }).then((r) => r.text());
  await sleep(1200);
  seen.slow = 2500; // the bot's next step is slow: Stop comes first
  const qb = await api("POST", `/api/chats/${dmB}/run`, { text: "CORRECTION-C: do this instead", entryId: "msteer2" });
  await sleep(200);
  await api("DELETE", `/api/chats/${dmB}/run`);
  seen.slow = 300;
  await startB;
  await sleep(800);
  c = await idle(dmB);
  const corrected = c.entries.filter((e) => e.kind === "bot").at(-1);
  check("B) after Stop, the message sent meanwhile starts the next run and gets its answer", qb.status === 202 && /CORRECTED/.test(corrected?.text || "") && c.entries.some((e) => e.id === "msteer2"), `${qb.status} ${corrected?.text}`);
  check("B) nothing is waiting any more", !c.running);

  // C: without a run, sending works as before.
  const dmC = `dm-${bots.find((b) => b.name === "Nova").id}`;
  const r = await fetch(`${BASE}/api/chats/${dmC}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
  await r.text();
  c = await idle(dmC);
  check("C) a normal message still starts a run", r.status === 200 && c.entries.filter((e) => e.kind === "bot").at(-1)?.text === "ok");

  // D: a long chat is summarized right after a run ends, not when the user writes next.
  const filler = "notes ".repeat(3300);
  let ended = 0;
  for (let k = 0; k < 14; k++) {
    const rr = await fetch(`${BASE}/api/chats/${dmC}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `part ${k}: ${filler}` }) });
    await rr.text();
    ended = Date.now();
    await idle(dmC);
    if ((await api("GET", `/api/chats/${dmC}`)).j.summary) break;
    await sleep(3500);
    if ((await api("GET", `/api/chats/${dmC}`)).j.summary) break;
  }
  const cs = (await api("GET", `/api/chats/${dmC}`)).j;
  check("D) a long chat gets its summary after a run, while nobody waits", !!cs.summary && /SUMMARY/.test(cs.summary.text) && (seen.summaries || []).some((t) => t >= ended), `${(seen.summaries || []).length} summaries`);

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
