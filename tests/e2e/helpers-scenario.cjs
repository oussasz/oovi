// Background helpers (lib/helpers.ts) and memory per bot with its change log (lib/memory.ts):
// a bot hands 2 parts of a job to helpers that run at the same time with only lookup + work-file tools,
// their rows land in the chat's table and their cost is counted; a bot keeps its own notes ("mine") that
// only it sees; a fact about the user with a number the user never wrote is refused; every memory change
// is in the journal and can be undone. Scripted model, nothing leaves this machine.
// Run: node tests/e2e/helpers-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-helpers-test");
const PORT = 3323;
const MODEL_PORT = 3396;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-helpers-log.txt");
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
const seen = { bodies: [], helpers: [] };
const toolNames = (b) => (b.tools || []).map((t) => t.name);
const sysOf = (b) => (typeof b.system === "string" ? b.system : (b.system || []).map((x) => x.text || "").join(""));
const lastResult = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((b) => b.type === "tool_result").map((b) => (typeof b.content === "string" ? b.content : (b.content || []).map((x) => x.text || "").join(""))).join("\n") : "";
};
const call = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${Math.random().toString(36).slice(2)}`, name, input }], "tool_use");

async function answer(body) {
  const msgs = body.messages || [];
  const all = msgs.map((m) => textOf(m) + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result").map((b) => (typeof b.content === "string" ? b.content : (b.content || []).map((x) => x.text || "").join(""))).join(" ") : "")).join("\n");
  const sys = sysOf(body);
  // The task is the latest message the user typed (earlier tasks in the same chat don't count).
  const cur = msgs.filter((m) => m.role === "user" && textOf(m).trim()).map(textOf).at(-1) || "";
  seen.bodies.push(body);
  if (/You are a helper working for another assistant/.test(sys)) {
    const city = /CITY-(\w+)/.exec(sys)?.[1] || "X";
    const h = { city, tools: toolNames(body), start: Date.now() };
    seen.helpers.push(h);
    await sleep(1200); // both helpers are "thinking" at once
    h.end = Date.now();
    if (msgs.length === 1) return call("work_table", { action: "add", table: "Leads", columns: ["Name", "City", "Source"], rows: [[`Shop ${city} 1`, city, "https://example.test"], [`Shop ${city} 2`, city, "https://example.test"]] });
    return reply([{ type: "text", text: `REPORT-${city}: added 2 rows to Leads.` }], "end_turn");
  }
  if (/HELPERS-A/.test(cur)) {
    if (!/REPORT-/.test(all)) return call("run_helpers", { tasks: ["Find 2 shops in CITY-Oran, add them to the table Leads", "Find 2 shops in CITY-Blida, add them to the table Leads"] });
    seen.helperResult = lastResult(msgs);
    return reply([{ type: "text", text: "HELPERS-DONE: 4 shops are in Leads." }], "end_turn");
  }
  if (/MINE-B/.test(cur)) {
    if (!/Saved|Added|added|saved/.test(lastResult(msgs))) return call("memory", { action: "add", target: "mine", content: "NOTE-B: always start lead lists with the city column" });
    return reply([{ type: "text", text: "MINE-DONE" }], "end_turn");
  }
  if (/FACT-C/.test(cur)) {
    const r = lastResult(msgs);
    if (!r) return call("memory", { action: "add", target: "user", content: "The user's phone is 0555 12 34 56" });
    if (/Not saved/.test(r) && !/FACT-OK/.test(all)) {
      seen.factRefused = r;
      return call("memory", { action: "add", target: "user", content: "FACT-OK: the user sells olive oil in Tlemcen" });
    }
    return reply([{ type: "text", text: "FACT-DONE" }], "end_turn");
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

  const run = async (chat, text) => {
    const r = await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    await r.text();
    return idle(chat);
  };

  // A: helpers.
  let c = await run(dm, "HELPERS-A: find shops in Oran and Blida");
  const offered = seen.bodies.find((b) => !/You are a helper/.test(sysOf(b)) && /HELPERS-A/.test((b.messages || []).map(textOf).join(" ")));
  check("A) a bot that can search is offered run_helpers", !!offered && toolNames(offered).includes("run_helpers"));
  const cities = [...new Set(seen.helpers.map((h) => h.city))].sort().join(",");
  check("A) one helper per task, each with only its own task", cities === "Blida,Oran", cities);
  const bad = seen.helpers.flatMap((h) => h.tools).filter((n) => ["run_helpers", "click", "type", "open_url", "memory", "browser_steps", "fill_login", "start_big_job"].includes(n));
  check("A) helpers get only lookup and work-file tools (no browser actions, no memory, no more helpers)", bad.length === 0 && seen.helpers[0].tools.includes("work_table"), [...new Set(bad)].join(","));
  const firsts = ["Oran", "Blida"].map((k) => seen.helpers.find((h) => h.city === k));
  check("A) the helpers work at the same time", firsts[0] && firsts[1] && firsts[0].start < firsts[1].end && firsts[1].start < firsts[0].end);
  const t = (await api("GET", `/api/chats/${dm}/canvas?table=Leads`)).j;
  check("A) the helpers' rows are in the chat's table", t.total === 4, JSON.stringify(t).slice(0, 200));
  check("A) the bot got both reports in one result", /REPORT-Oran/.test(seen.helperResult || "") && /REPORT-Blida/.test(seen.helperResult || ""));
  const botE = c.entries.filter((e) => e.kind === "bot").at(-1);
  const calls = seen.bodies.filter((b) => /HELPERS-A/.test((b.messages || []).map(textOf).join(" ")) || /You are a helper/.test(sysOf(b))).length;
  check("A) the helpers' cost is counted on the bot's message", /HELPERS-DONE/.test(botE?.text || "") && Math.abs((botE.credits || 0) - calls) < 0.01, `${botE?.credits} credits for ${calls} calls`);

  // B: own notes.
  const quill = bots.find((b) => b.name === "Quill");
  c = await run(dm, "MINE-B: remember how you work");
  seen.bodies = [];
  await run(dm, "hello again");
  const sysScout = sysOf(seen.bodies.at(-1) || {});
  check("B) a bot's own notes are in its next instructions", /Your own notes/.test(sysScout) && /NOTE-B/.test(sysScout));
  seen.bodies = [];
  await run(`dm-${quill.id}`, "hello Quill");
  check("B) another bot doesn't see them", !/NOTE-B/.test(sysOf(seen.bodies.at(-1) || {})));

  // C: evidence.
  const cc = await run(dm, "FACT-C: I sell olive oil in Tlemcen, remember that");
  check("C) a fact with a number the user never wrote is refused", /Not saved/.test(seen.factRefused || ""), seen.factRefused);
  let mem = (await api("GET", "/api/memory")).j;
  check("C) a fact from the user's words is saved", /olive oil in Tlemcen/.test(mem.user) && !/0555/.test(mem.user));

  // D: journal + undo.
  const j = (await api("GET", "/api/memory/journal")).j.changes;
  const fact = j.find((e) => e.target === "user" && /olive/.test(e.after || ""));
  const note = j.find((e) => e.target === "mine" && /NOTE-B/.test(e.after || ""));
  check("D) every change is in the journal, with the bot that made it", !!fact && !!note && fact.bot === "Scout" && note.bot === "Scout", JSON.stringify(j).slice(0, 300));
  const u = await api("POST", "/api/memory/journal", { id: fact?.id });
  mem = (await api("GET", "/api/memory")).j;
  check("D) undo puts memory back as it was", u.status === 200 && !/olive oil/.test(mem.user), JSON.stringify(u.j));
  const again = await api("POST", "/api/memory/journal", { id: fact?.id });
  check("D) the same change can't be undone twice", again.status === 409);

  log(`${results.filter((x) => x.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
