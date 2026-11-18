// The cloud runner (runner/) against a stand-in website (the runner-only API of docs/CLOUD-BUILD.md) and a
// stand-in theOovi behind it. Nothing leaves this machine. Needs the built server (npm run build).
//   A) a phone message is claimed, answered by theOovi (billed to that account), the chat pushed, the job done
//   B) a step that needs the computer: the bot answers in the user's language (French), the job is needs_computer
//   C) two accounts at the same time: each run sees only its own bots and answers, the jobs' servers never hold
//      the runner's secret, and every job folder is wiped
//   D) SIGTERM while a job runs: the chat is pushed, the lease goes back to the queue, the runner exits
//   E) the logs never carry chat text
// Run: node tests/e2e/runner-scenario.cjs
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const WEB_PORT = 3431;
const SECRET = "test-runner-secret-0123456789abcdef-xyz";
const TMP = path.join(os.tmpdir(), "oovi-runner-test");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

// ---------- the stand-in website ----------
const bot = (id, name, extra = {}) => ({ id, name, role: "Helper", instructions: `You are ${name}.`, face: {}, tools: { web: true, browser: true }, createdAt: 1, ...extra });
const setups = {
  ua: { version: 3, items: { "bot:ava1": bot("ava1", "Ava"), main: "ava1", "memory:user": "Lives in Oran." } },
  ub: { version: 7, items: { "bot:bex1": bot("bex1", "Bex"), main: "bex1" } },
};
const chats = new Map(); // `${uid}/${chatId}` -> {version, chat}
const jobs = []; // {id, userId, chatId, kind, payload, status, claims, released, lease}
const aiCalls = []; // {uid, system, ask}
const setupPuts = [];
let nextJob = 1;
const addJob = (userId, chatId, text) => {
  const j = { id: `job-${nextJob++}-0000`, userId, chatId, kind: "message", payload: { text }, status: "queued", claims: 0, released: 0, createdAt: new Date().toISOString(), timezone: "Africa/Algiers" };
  jobs.push(j);
  return j;
};

const textOf = (m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(m.content || ""));
const sysText = (s) => (Array.isArray(s) ? s.map((b) => b.text || "").join(" ") : String(s || ""));
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 40 }, oovi: { balance: 99, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 } });

async function theOovi(uid, body) {
  const msgs = body.messages || [];
  const users = msgs.filter((m) => m.role === "user" && textOf(m).trim());
  const ask = textOf(users.at(-1) || {});
  aiCalls.push({ uid, system: sysText(body.system), ask });
  if (!(body.tools || []).length) return reply([{ type: "text", text: "ok" }], "end_turn");
  const n = msgs.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use").length : 0), 0);
  const use = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${n}_${Date.now()}`, name, input }], "tool_use");
  if (/NEEDPC/.test(ask)) return use("open_url", { url: "https://example.com" });
  if (/SLOW/.test(ask)) {
    await sleep(700);
    if (n < 8) return use("oovi_help", { topic: "overview" });
    return reply([{ type: "text", text: "SLOW-DONE" }], "end_turn");
  }
  await sleep(400);
  const who = /You are (\w+)/.exec(sysText(body.system))?.[1] || "nobody";
  return reply([{ type: "text", text: `ANSWER from ${who} for ${uid}` }], "end_turn");
}

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readJson = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    try {
      resolve(b ? JSON.parse(b) : {});
    } catch {
      resolve({});
    }
  });
});

const website = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/v1/catalog") return send(res, 200, { items: [] });
  const m = /^\/api\/v1\/cloud\/runner(\/.*)$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: "not found" });
  if (req.headers["x-oovi-runner"] !== SECRET) return send(res, 403, { error: "forbidden" });
  const p = m[1];
  const body = req.method === "GET" ? {} : await readJson(req);
  let r;
  if (p === "/claim" && req.method === "POST") {
    const exclude = new Set(Array.isArray(body.exclude) ? body.exclude : []);
    const j = jobs.find((x) => x.status === "queued" && !exclude.has(x.userId));
    if (!j) return send(res, 200, { job: null });
    j.status = "claimed";
    j.claims++;
    j.lease = Date.now() + 120_000;
    const { status: _s, claims: _c, released: _r, lease: _l, ...job } = j;
    return send(res, 200, { job });
  }
  if ((r = /^\/jobs\/([\w-]+)\/(heartbeat|done|release)$/.exec(p))) {
    const j = jobs.find((x) => x.id === r[1]);
    if (!j || j.status !== "claimed") return send(res, 409, { error: "not yours" });
    if (r[2] === "heartbeat") j.lease = Date.now() + 120_000;
    else if (r[2] === "release") {
      j.status = "queued";
      j.released++;
    } else {
      j.status = body.status;
      j.error = body.error;
    }
    return send(res, 200, { ok: true });
  }
  if ((r = /^\/chats\/([\w-]+)\/([\w-]+)$/.exec(p))) {
    const key = `${r[1]}/${r[2]}`;
    const cur = chats.get(key);
    if (req.method === "GET") return cur ? send(res, 200, { chatId: r[2], version: cur.version, chat: cur.chat }) : send(res, 404, { error: "no chat" });
    if (req.method === "PUT") {
      if ((cur?.version ?? 0) !== body.baseVersion) return send(res, 409, { version: cur?.version ?? 0, chat: cur?.chat ?? null });
      const version = (cur?.version ?? 0) + 1;
      chats.set(key, { version, chat: body.chat, pushes: (cur?.pushes ?? 0) + 1 });
      return send(res, 200, { version });
    }
  }
  if ((r = /^\/setup\/([\w-]+)$/.exec(p))) {
    const s = setups[r[1]];
    if (req.method === "GET") return send(res, 200, s ?? { version: 0, items: null });
    if (req.method === "PUT") {
      setupPuts.push({ uid: r[1], body });
      if (body.baseVersion !== s.version) return send(res, 409, { error: "version" });
      s.version++;
      s.items = body.items;
      return send(res, 200, { version: s.version });
    }
  }
  if ((r = /^\/vault\/([\w-]+)\/([\w-]+)$/.exec(p))) return send(res, 404, { error: "none" });
  if ((r = /^\/ai\/([\w-]+)$/.exec(p)) && req.method === "POST") return send(res, 200, await theOovi(r[1], body));
  send(res, 404, { error: "unknown" });
});

// ---------- the runner ----------
let out = "";
function startRunner(extra = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, "runner/index.mjs")], {
    env: { ...process.env, OOVI_WEB_URL: `http://127.0.0.1:${WEB_PORT}`, RUNNER_SECRET: SECRET, RUNNER_ID: "test-runner", RUNNER_TMP: TMP, RUNNER_CONCURRENCY: "2", RUNNER_HEARTBEAT_MS: "2000", RUNNER_PUSH_MS: "300", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  return child;
}
const waitFor = async (fn, ms, what) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (fn()) return true;
    await sleep(200);
  }
  console.log(`timed out waiting for ${what}`);
  return false;
};
const lastBot = (key) => [...(chats.get(key)?.chat?.entries ?? [])].reverse().find((e) => e.kind === "bot");
const jobFolders = () => fs.readdirSync(TMP).filter((f) => f.startsWith("job-"));

(async () => {
  await new Promise((r) => website.listen(WEB_PORT, "127.0.0.1", r));
  let runner = startRunner();

  // A + C: two accounts at once.
  const ja = addJob("ua", "dm-ava1", "Hello Ava, what's the weather like for a walk?");
  const jb = addJob("ub", "dm-bex1", "Bonjour Bex, tu peux me dire bonjour ?");
  let sawChildEnv = null;
  const envProbe = setInterval(() => {
    if (process.platform !== "linux" || sawChildEnv) return;
    for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
      try {
        const env = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
        if (env.includes("OOVI_CLOUD_RUNNER=1")) sawChildEnv = env;
      } catch {
        /* gone */
      }
    }
  }, 100);
  await waitFor(() => ja.status !== "claimed" && ja.status !== "queued" && jb.status !== "claimed" && jb.status !== "queued", 120_000, "jobs A and B");
  clearInterval(envProbe);
  check(ja.status === "done" && jb.status === "done", `A: both jobs done (${ja.status}/${jb.status} ${ja.error || ""}${jb.error || ""})`);
  check(/ANSWER from Ava for ua/.test(lastBot("ua/dm-ava1")?.text || ""), "A: account ua's chat has Ava's answer, pushed to the website");
  check(/ANSWER from Bex for ub/.test(lastBot("ub/dm-bex1")?.text || ""), "C: account ub's chat has Bex's answer");
  const userEntry = chats.get("ua/dm-ava1")?.chat?.entries?.find((e) => e.kind === "user");
  check(userEntry?.text === ja.payload.text && userEntry.id === `j${ja.id.replace(/[^\w]/g, "").slice(0, 24)}`, "A: the phone's message is in the chat once, with the job's entry id");
  const callsA = aiCalls.filter((c) => c.uid === "ua");
  const callsB = aiCalls.filter((c) => c.uid === "ub");
  check(callsA.length > 0 && callsA.every((c) => /You are Ava/.test(c.system) && !/Bex/.test(c.system)), "C: every theOovi call billed to ua sees only ua's bot");
  check(callsB.length > 0 && callsB.every((c) => /You are Bex/.test(c.system) && !/Ava/.test(c.system)), "C: every theOovi call billed to ub sees only ub's bot");
  check(callsA.some((c) => /Lives in Oran/.test(c.system)) && !callsB.some((c) => /Oran/.test(c.system)), "C: what ua's bots know about ua never reaches ub's run");
  check(!JSON.stringify(chats.get("ub/dm-bex1")).includes("Ava"), "C: ub's chat holds nothing of ua");
  if (process.platform === "linux") check(!!sawChildEnv && !sawChildEnv.includes(SECRET) && !sawChildEnv.includes("RUNNER_SECRET"), "C: a job's server never holds the runner's secret");
  await waitFor(() => jobFolders().length === 0, 10_000, "job folders wiped");
  check(jobFolders().length === 0, "C: every job folder is wiped");
  check(setupPuts.every((s) => s.uid === "ua" || s.uid === "ub"), "C: setup writes only go to the job's own account");

  // B: needs the computer, in French.
  const jn = addJob("ua", "dm-ava1", "NEEDPC ouvre le site de la mairie et je veux que tu remplisses le formulaire");
  await waitFor(() => jn.status !== "claimed" && jn.status !== "queued", 60_000, "job needing the computer");
  check(jn.status === "needs_computer", `B: the job ends as needs_computer (${jn.status})`);
  const nb = lastBot("ua/dm-ava1");
  check(/ordinateur/.test(nb?.text || "") && /oovi/.test(nb?.text || ""), `B: the bot says so in French (${(nb?.text || "").slice(0, 60)})`);
  check(aiCalls.filter((c) => /NEEDPC/.test(c.ask)).length === 1, "B: no model call after the step that needed the computer");

  // D: SIGTERM while a job runs.
  runner.kill("SIGTERM");
  await new Promise((r) => runner.on("exit", r));
  runner = startRunner({ RUNNER_DRAIN_MS: "1000" });
  const js = addJob("ub", "dm-bex1", "SLOW job, keep working please");
  await waitFor(() => aiCalls.filter((c) => /SLOW/.test(c.ask)).length >= 3, 60_000, "slow job running");
  const pushesBefore = chats.get("ub/dm-bex1")?.pushes ?? 0;
  const t0 = Date.now();
  runner.kill("SIGTERM");
  const code = await new Promise((r) => runner.on("exit", (c) => r(c)));
  check(code === 0 && Date.now() - t0 < 30_000, `D: the runner stops cleanly on SIGTERM (exit ${code}, ${Date.now() - t0} ms)`);
  check(js.status === "queued" && js.released === 1, `D: the lease went back to the queue (${js.status}, released ${js.released})`);
  check((chats.get("ub/dm-bex1")?.pushes ?? 0) > pushesBefore, "D: the chat was pushed before stopping");
  check(jobFolders().length === 0, "D: the job folder is wiped");

  // The released job runs again on a new runner, from the start of its message (no second copy).
  runner = startRunner();
  await waitFor(() => js.status !== "claimed" && js.status !== "queued", 120_000, "released job finishing");
  const entries = chats.get("ub/dm-bex1")?.chat?.entries ?? [];
  check(js.status === "done" && /SLOW-DONE/.test(lastBot("ub/dm-bex1")?.text || ""), `D: the released job is picked up again and finished (${js.status})`);
  check(entries.filter((e) => e.kind === "user" && /SLOW/.test(e.text)).length === 1, "D: its message is in the chat once");
  runner.kill("SIGTERM");
  await new Promise((r) => runner.on("exit", r));

  // E: logs.
  const leaked = ["weather", "Bonjour", "mairie", "ANSWER", "Oran", "SLOW", SECRET].filter((w) => out.includes(w));
  check(leaked.length === 0, `E: no chat text or secret in the runner's logs${leaked.length ? ` (found: ${leaked.join(", ")})` : ""}`);
  check(out.split("\n").filter(Boolean).every((l) => l.startsWith("{")), "E: every log line is a JSON event");

  website.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
