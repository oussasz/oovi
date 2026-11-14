// What a bot's work costs in prompt cache, measured on the real request bodies (nothing leaves this machine).
// A scripted stand-in for theOovi's model plays a research turn: 14 web pages read one by one, rows saved,
// a final answer; then a follow-up message with 4 more pages. Every request is recorded and billed the way
// Anthropic's prompt cache bills it: the longest prefix already written is a cache read (0.1x), the rest up to
// the last cache mark is a cache write (1.25x). Prints the totals, and checks the limits the harness promises:
//   A) a request's web page text stays bounded however many pages were read,
//   B) the instructions and tools don't change between the steps of a turn (they stay cached),
//   C) routine steps ask for effort "medium" without extended thinking (unless the user chose more).
// Run: node tests/e2e/cost-scenario.cjs   (prints COST: … lines; OOVI_COST_BASELINE=1 skips the checks).
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-cost-test");
const PORT = 3318;
const MODEL_PORT = 3397;
const SITE_PORT = 3396;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-cost-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASELINE = process.env.OOVI_COST_BASELINE === "1";

// ---- the web: long pages, as real directory and article pages are ----
const para = (i, k) => `<p>Établissement ${i}, paragraphe ${k} : horaires, services, avis des clients, accès et stationnement. Ouvert du samedi au jeudi, réservation conseillée le week-end. Le quartier est animé, avec des commerces et des cafés tout autour.</p>`;
http
  .createServer((req, res) => {
    const m = /^\/page(\d+)/.exec(req.url);
    if (!m) return res.writeHead(404).end();
    const i = Number(m[1]);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>Café ${i}</title></head><body><article><h1>Café ${i} à Alger</h1><p>Téléphone : 0550 12 ${String(10 + i).padStart(2, "0")} ${String(20 + i).padStart(2, "0")}</p>${Array.from({ length: 160 }, (_, k) => para(i, k)).join("")}</article></body></html>`);
  })
  .listen(SITE_PORT, "127.0.0.1");

// ---- the model stand-in ----
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 40 }, oovi: live() });
const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
const requests = [];

function answer(body) {
  const msgs = body.messages || [];
  const users = msgs.filter((m) => m.role === "user" && textOf(m).trim());
  const ask = textOf(users.at(-1) || {});
  // tool calls since the user's latest COST message
  let latest = 0;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user" && /COST/.test(textOf(msgs[i]))) { latest = i; break; }
  const n = msgs.slice(latest).reduce((k, m) => k + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").length : 0), 0);
  if (!/COST/.test(ask)) return reply([{ type: "text", text: "ok" }], "end_turn");
  requests.push({ body, phase: /COST2/.test(ask) ? 2 : 1 });
  const use = (name, input) => reply([{ type: "text", text: "" }, { type: "tool_use", id: `toolu_${name}_${n}_${Date.now()}`, name, input }].filter((b) => b.type !== "text" || b.text), "tool_use");
  const pages = /COST2/.test(ask) ? [15, 16, 17, 18] : Array.from({ length: 14 }, (_, k) => k + 1);
  // read a page, then save its row, page after page
  const step = Math.floor(n / 2);
  if (step < pages.length) {
    const p = pages[step];
    if (n % 2 === 0) return use("read_url", { url: `${SITE}/page${p}` });
    return use("work_table", { action: "add", table: "Cafés Alger", columns: ["Name", "Phone", "Source"], rows: [[`Café ${p}`, `0550 12 ${String(10 + p).padStart(2, "0")} ${String(20 + p).padStart(2, "0")}`, `${SITE}/page${p}`]] });
  }
  return reply([{ type: "text", text: `COST-DONE: ${pages.length} cafés added to Cafés Alger.` }], "end_turn");
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
        const refused = rules.refusal(b);
        if (refused) return send(400, { error: refused });
        if (rules.isDoneCheck(b)) return send(200, rules.doneReply(b));
        try {
          return send(200, answer(b));
        } catch (e) {
          return send(400, { error: String(e) });
        }
      }
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

// ---- Anthropic's cache, simulated on the blocks in order: tools, system, then every message block ----
const tok = (v) => Math.ceil(JSON.stringify(v).length / 3);
function blocksOf(body) {
  const out = [];
  for (const t of body.tools || []) out.push({ v: { ...t, cache_control: undefined }, mark: !!t.cache_control });
  const sys = typeof body.system === "string" ? [{ type: "text", text: body.system }] : body.system || [];
  for (const s of sys) out.push({ v: { ...s, cache_control: undefined }, mark: !!s.cache_control });
  for (const m of body.messages || []) {
    const content = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of content) out.push({ v: { role: m.role, ...b, cache_control: undefined }, mark: !!b.cache_control });
  }
  return out;
}
function bill(reqs) {
  const written = new Set();
  let read = 0, write = 0, fresh = 0, prefixChanges = 0, prevSys = null, maxPage = 0;
  for (const { body } of reqs) {
    const blocks = blocksOf(body);
    let h = crypto.createHash("sha256");
    const keys = [];
    const sizes = [];
    for (const b of blocks) {
      h.update(JSON.stringify(b.v));
      keys.push(h.copy().digest("hex"));
      sizes.push(tok(b.v));
    }
    // the longest prefix already written (Anthropic finds it at a cache mark or a little before)
    let hit = -1;
    for (let i = blocks.length - 1; i >= 0; i--) if (written.has(keys[i])) { hit = i; break; }
    const lastMark = blocks.map((b, i) => (b.mark ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
    let r = 0, w = 0, f = 0;
    sizes.forEach((s, i) => (i <= hit ? (r += s) : i <= lastMark ? (w += s) : (f += s)));
    read += r; write += w; fresh += f;
    if (process.env.OOVI_COST_DETAIL) log(`  req: blocks ${blocks.length} | total ${sizes.reduce((a, b) => a + b, 0)} | read ${r} | write ${w} | hit at block ${hit}`);
    // every block written at once is a prefix the next request can hit (marks and the 20 blocks before)
    for (let i = 0; i <= lastMark; i++) written.add(keys[i]);
    const sysKey = JSON.stringify([body.tools, body.system].map((x) => JSON.stringify(x)));
    if (prevSys !== null && prevSys !== sysKey) prefixChanges++;
    prevSys = sysKey;
    for (const m of body.messages || []) for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === "tool_result") {
      const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      if (/PAGE CONTENT/.test(t)) maxPage = Math.max(maxPage, 0);
    }
  }
  return { read, write, fresh, prefixChanges, cost: read * 0.1 + write * 1.25 + fresh };
}
// page text in one request: all read_url results still in view
const pageChars = (body) => (body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result").map((b) => (typeof b.content === "string" ? b.content : JSON.stringify(b.content))).filter((t) => /PAGE CONTENT/.test(t)).reduce((k, t) => k + t.length, 0);

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
  await api("POST", "/api/settings", { browser: { allowPrivateNetwork: true } });
  const bots = await api("GET", "/api/bots");
  const scout = bots.find((b) => b.name === "Scout");
  const dm = `dm-${scout.id}`;
  const run = async (text) => {
    await api("POST", `/api/chats/${dm}/run`, { text });
    for (let i = 0; i < 600; i++) {
      const c = await api("GET", `/api/chats/${dm}`);
      if (!c.running) return c;
      await sleep(300);
    }
    throw new Error("the run didn't end");
  };
  let c = await run("COST: find cafés in Algiers with their phone numbers, page by page");
  c = await run("COST2: and 4 more please");
  const last = c.entries.filter((e) => e.kind === "bot").at(-1)?.text ?? "";
  const b = bill(requests);
  if (process.env.OOVI_COST_DETAIL) {
    const sys = (r) => (typeof r.body.system === "string" ? r.body.system : r.body.system.map((x) => x.text).join(""));
    fs.writeFileSync(path.join(os.tmpdir(), "cost-sys1.txt"), sys(requests.find((r) => r.phase === 1)));
    fs.writeFileSync(path.join(os.tmpdir(), "cost-sys2.txt"), sys(requests.find((r) => r.phase === 2)));
    log(`phases: ${requests.filter((r) => r.phase === 1).length} + ${requests.filter((r) => r.phase === 2).length}`);
  }
  const pages = requests.map((r) => pageChars(r.body));
  const effortOf = (r) => `${r.body.effort ?? "none"}${r.body.thinking === false ? "/no-thinking" : ""}`;
  const firstOfTurn = (r, i) => i === 0 || requests[i - 1].phase !== r.phase;
  const efforts = [...new Set(requests.filter((r, i) => !firstOfTurn(r, i)).map(effortOf))];
  const firsts = [...new Set(requests.filter((r, i) => firstOfTurn(r, i)).map(effortOf))];
  log(`COST: ${requests.length} requests | cache read ${b.read.toLocaleString("en-US")} | cache write ${b.write.toLocaleString("en-US")} | uncached ${b.fresh.toLocaleString("en-US")} tokens | weighted ${Math.round(b.cost).toLocaleString("en-US")} | instructions/tools changed ${b.prefixChanges}x | page text per request max ${Math.max(...pages).toLocaleString("en-US")} chars | effort: first step ${firsts.join(", ")}, then ${efforts.join(", ")}`);
  check("the work is done (all 18 cafés saved, final answer given)", /^COST-DONE: 4/.test(last), last.slice(0, 80));
  if (!BASELINE) {
    check("A) web page text in a request stays bounded (≤ 40,000 characters)", Math.max(...pages) <= 40_000, `${Math.max(...pages)} chars`);
    check("B) instructions and tools don't change between the steps of a turn", b.prefixChanges <= 1, `${b.prefixChanges} changes`);
    check("C) the first step of a message keeps the model's level; routine steps ask for medium without extended thinking", firsts.length === 1 && firsts[0] === "none" && efforts.length === 1 && efforts[0] === "medium/no-thinking", `${firsts.join(", ")} then ${efforts.join(", ")}`);
  }
  log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  server.kill();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  log(`ERROR ${e.message}`);
  server?.kill();
  process.exit(2);
});
