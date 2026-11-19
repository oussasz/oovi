// The three cloud parts together, for real: the website (web/, built, on a THROWAWAY local PostgreSQL), the desktop
// app (built, part A's sync) and the cloud runner (part R), with a stand-in only for theOovi's upstream model and a
// small stand-in connector (a real MCP server on this machine that needs its key).
//   1) desktop → website: sync on, setup and chats uploaded, a connector with its key goes to the vault
//   2) phone → website with the desktop on: the desktop claims and answers
//   3) desktop off: the runner claims (as Node, then as the Docker image if RUNNER_IMAGE is set), installs the
//      connector from the vault exactly as the desktop wrote it, calls it, answers, pushes; GET /chats shows it
//   4) a step that needs the computer: the runner answers so and ends needs_computer; the desktop, back on, picks it
//      up and runs it, the message shows once
//
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/oovi_test node tests/e2e/cloud-integration-scenario.cjs
// Needs: npm run build (root) and the website built (cd web && BETTER_AUTH_SECRET=local-test-secret-0123456789abcdef
// npm run build). Refuses any database that isn't on this machine.
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const WEB = path.join(ROOT, "web");
const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database on this machine.");
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(DB).hostname)) throw new Error("Refusing a database that isn't on this machine.");
const { Pool } = require(require.resolve("pg", { paths: [WEB] }));
const db = new Pool({ connectionString: DB });

const WEB_PORT = 3592;
const APP_PORT = 3593;
const SITE = `http://127.0.0.1:${WEB_PORT}`;
const APP = `http://127.0.0.1:${APP_PORT}`;
const RUNNER_SECRET = crypto.randomBytes(32).toString("hex");
const CONNECTOR_KEY = `conn-key-${crypto.randomBytes(6).toString("hex")}`;
const USER = "cloudint_u1";
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "oovi-cloudint-app-"));
const RTMP = fs.mkdtempSync(path.join(os.tmpdir(), "oovi-cloudint-runner-"));
fs.chmodSync(RTMP, 0o777);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
  if (!ok) fails++;
};
const waitFor = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  console.log(`  (gave up waiting for: ${what})`);
  return null;
};

// ---------- a stand-in Telegram API (the website sends a routine's result there while the computer is off) ----------
const tgSent = [];
const telegram = http.createServer((rq, rs) => {
  let b = "";
  rq.on("data", (c) => (b += c));
  rq.on("end", () => {
    const method = rq.url.split("/").pop();
    if (method === "sendMessage") tgSent.push(JSON.parse(b || "{}"));
    rs.writeHead(200, { "content-type": "application/json" });
    rs.end(JSON.stringify({ ok: true, result: method === "getMe" ? { id: 1, is_bot: true, username: "sara_oovi_bot" } : true }));
  });
});

// ---------- the stand-in for theOovi's upstream model (Anthropic Messages API) ----------
const calls = [];
const textOf = (m) => (typeof m.content === "string" ? m.content : (m.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" "));
const results = (msgs) => msgs.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result") : []));
const resultText = (r) => (typeof r.content === "string" ? r.content : (r.content || []).map((b) => b.text || "").join(" "));
const model = http.createServer((rq, rs) => {
  let b = "";
  rq.on("data", (c) => (b += c));
  rq.on("end", () => {
    const body = JSON.parse(b || "{}");
    const msgs = body.messages || [];
    const ask = textOf([...msgs].reverse().find((m) => m.role === "user" && textOf(m).trim()) || {});
    const tools = (body.tools || []).map((t) => t.name);
    calls.push({ ask, tools });
    const out = (content, stop) => {
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: "stand-in", content, stop_reason: stop, usage: { input_tokens: 500, output_tokens: 50 } }));
    };
    const use = (name, input) => out([{ type: "tool_use", id: `toolu_${crypto.randomBytes(4).toString("hex")}`, name, input }], "tool_use");
    if (!tools.length) return out([{ type: "text", text: "ok" }], "end_turn");
    // Tool results of this turn only (after the user's latest message).
    let last = 0;
    msgs.forEach((m, i) => {
      if (m.role === "user" && textOf(m).trim()) last = i;
    });
    const done = results(msgs.slice(last));
    if (/CONNECTOR/.test(ask)) {
      const t = tools.find((n) => n.startsWith("mcp_") && n.endsWith("lookup"));
      if (!t) return out([{ type: "text", text: `NO-CONNECTOR-TOOL (${tools.filter((n) => n.startsWith("mcp_")).join(",")})` }], "end_turn");
      if (!done.length) return use(t, { q: "x" });
      return out([{ type: "text", text: `CONNECTOR-ANSWER ${resultText(done.at(-1))}` }], "end_turn");
    }
    if (/NEEDPC/.test(ask)) {
      // A document saved on the computer: no card on the desktop, and not something the cloud does.
      if (!done.length) return use("create_document", { filename: "resume.docx", title: "Résumé", markdown: "# Résumé" });
      return out([{ type: "text", text: "DONE-ON-THE-COMPUTER" }], "end_turn");
    }
    const tag = /\b(PHONE-\w+)/.exec(ask)?.[1] || "MSG";
    out([{ type: "text", text: `REPLY ${tag}` }], "end_turn");
  });
});

// ---------- a stand-in connector: an MCP server that needs its key ----------
const { McpServer } = require(require.resolve("@modelcontextprotocol/sdk/server/mcp.js", { paths: [ROOT] }));
const { StreamableHTTPServerTransport } = require(require.resolve("@modelcontextprotocol/sdk/server/streamableHttp.js", { paths: [ROOT] }));
let connectorCalls = 0;
const connector = http.createServer(async (rq, rs) => {
  if (rq.headers.authorization !== `Bearer ${CONNECTOR_KEY}`) {
    rs.writeHead(401).end();
    return;
  }
  let b = "";
  for await (const c of rq) b += c;
  const server = new McpServer({ name: "notes", version: "1.0.0" });
  server.tool("lookup", "Look up a note", async () => {
    connectorCalls++;
    return { content: [{ type: "text", text: "MCP-RESULT-42" }] };
  });
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  rs.on("close", () => {
    t.close();
    server.close();
  });
  await server.connect(t);
  await t.handleRequest(rq, rs, b ? JSON.parse(b) : undefined);
});

// ---------- helpers ----------
let TOKEN = "";
const site = (method, p, body, headers = {}) =>
  fetch(SITE + p, { method, headers: { authorization: `Bearer ${TOKEN}`, "x-oovi-device": "phone:testphone1", ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
const app = (method, p, body) => fetch(APP + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
const job = async (id) => (await db.query("SELECT status, claimed_by, error FROM cloud_job WHERE id = $1", [id])).rows[0];
const finished = (id) => async () => {
  const j = await job(id);
  return j && ["done", "failed", "needs_computer"].includes(j.status) ? j : null;
};
const cloudChat = async (chatId) => (await site("GET", `/api/v1/cloud/chats/${chatId}`)).j?.chat;
const texts = (c) => (c?.entries || []).map((e) => e.text || "");

let webProc = null;
let appProc = null;
let runnerProc = null;
let out = "";
function startApp() {
  appProc = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_CLOUD_URL: SITE, OOVI_TELEGRAM_API: "http://127.0.0.1:1", PORT: String(APP_PORT) },
    stdio: process.env.DEBUG ? "inherit" : "ignore",
  });
  return waitFor("the desktop app", async () => (await fetch(`${APP}/api/account`)).ok, 90_000);
}
async function stopApp() {
  appProc.kill("SIGTERM");
  await new Promise((r) => appProc.on("exit", r));
  // Seen 60 s ago at the latest: the website would call it online for another minute. Made "long ago" here.
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '1 hour' WHERE user_id = $1 AND kind = 'desktop'", [USER]);
}
function startRunner() {
  const env = { OOVI_WEB_URL: SITE, RUNNER_SECRET, RUNNER_ID: "int-runner", RUNNER_CONCURRENCY: "2", RUNNER_HEARTBEAT_MS: "5000", RUNNER_PUSH_MS: "500", RUNNER_TEST_HOSTS: `127.0.0.1:${connector.address().port}` };
  const image = process.env.RUNNER_IMAGE;
  runnerProc = image
    ? spawn("docker", ["run", "--rm", "--init", "--network", "host", "--read-only", "--tmpfs", "/tmp:mode=1777", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), image], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, [path.join(ROOT, "runner/index.mjs")], { env: { ...process.env, ...env, RUNNER_TMP: RTMP }, stdio: ["ignore", "pipe", "pipe"] });
  runnerProc.stdout.on("data", (d) => (out += d));
  runnerProc.stderr.on("data", (d) => (out += d));
}
async function stopRunner() {
  runnerProc.kill("SIGTERM");
  await new Promise((r) => runnerProc.on("exit", r));
}

(async () => {
  // ---- database and the website ----
  const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], { cwd: WEB, env: { ...process.env, DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB }, encoding: "utf8" });
  check("the website's tables are created", mig.status === 0, mig.stderr);
  await db.query(`DELETE FROM "user" WHERE id = $1`, [USER]);
  await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Sara', 'sara@int.test', true, now(), now())`, [USER]);
  TOKEN = crypto.randomBytes(24).toString("hex");
  await db.query(`INSERT INTO session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, now() + interval '1 day', now(), now())`, [`s_${USER}`, TOKEN, USER]);
  await db.query("INSERT INTO credit_accounts (user_id, balance_mc) VALUES ($1, $2)", [USER, 1000 * 1000]);
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  await new Promise((r) => connector.listen(0, "127.0.0.1", r));
  await new Promise((r) => telegram.listen(0, "127.0.0.1", r));
  webProc = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [WEB] }), "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: DB, BETTER_AUTH_SECRET: "local-test-secret-0123456789abcdef", BETTER_AUTH_URL: SITE, RUNNER_SECRET, ANTHROPIC_API_KEY: "test-key-not-real", OOVI_AI_UPSTREAM: `http://127.0.0.1:${model.address().port}`, OOVI_TELEGRAM_API: `http://127.0.0.1:${telegram.address().port}`, NODE_ENV: "production" },
    stdio: process.env.DEBUG ? "inherit" : "ignore",
  });
  await waitFor("the website", async () => (await fetch(`${SITE}/api/v1/health`)).ok, 60_000);

  // ---- the desktop app, signed in to that account (its session sealed as lib/account.ts reads it) ----
  fs.mkdirSync(DATA, { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(path.join(DATA, ".device-key"), key.toString("hex"));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(TOKEN, "utf8"), c.final()]);
  fs.writeFileSync(path.join(DATA, "session.json"), JSON.stringify({ token: ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":"), user: { id: USER, email: "sara@int.test", name: "Sara", image: null }, onboarded: true, savedAt: Date.now() }));
  await startApp();

  try {
    // ---- 1) desktop → website ----
    const conn = await app("POST", "/api/mcp", { name: "Notes", transport: "http", url: `http://127.0.0.1:${connector.address().port}/mcp`, headers: { Authorization: `Bearer ${CONNECTOR_KEY}` } });
    check("a connector with its key is added on the desktop", conn.status < 300 && conn.j?.id, JSON.stringify(conn.j));
    await app("PUT", `/api/mcp/${conn.j.id}`, { trusted: true });
    const bots = (await app("GET", "/api/bots")).j;
    const oovi = bots.find((b) => b.name === "Oovi") || bots[0];
    const { id: _i, createdAt: _c, ...input } = oovi;
    const saved = await app("PUT", `/api/bots/${oovi.id}`, { ...input, tools: { ...oovi.tools, mcp: [conn.j.id] } });
    check("the bot gets the connector", saved.status < 300, JSON.stringify(saved.j));
    const dm = `dm-${oovi.id}`;
    await app("POST", `/api/chats/${dm}/run`, { text: "PHONE-zero hello from the computer" }).then((r) => r.text?.());
    await waitFor("the first answer", async () => !(await app("GET", `/api/chats/${dm}`)).j?.running && texts((await app("GET", `/api/chats/${dm}`)).j).includes("REPLY PHONE-zero"));
    const on = await app("POST", "/api/cloud", { action: "on" });
    check("sync turned on from the desktop", on.status === 200, JSON.stringify(on.j));
    await app("POST", "/api/account/sync", {});
    await app("POST", "/api/cloud", { action: "sync" });
    const status = await waitFor("the website has the chat", async () => {
      const s = (await site("GET", "/api/v1/cloud/status")).j;
      return s?.enabled && s.chats > 0 ? s : null;
    });
    check("the website: sync on, the chat is there", !!status, JSON.stringify(status));
    check("the chat on the website is the desktop's", texts(await cloudChat(dm)).includes("REPLY PHONE-zero"));
    const setup = (await db.query("SELECT version FROM account_setup WHERE user_id = $1", [USER])).rows[0];
    check("the setup (bots, connector without its key) is on the website", !!setup, "no account_setup row");
    const vault = await waitFor("the connector in the vault", async () => (await site("GET", `/api/v1/cloud/vault/${conn.j.id}`)).j?.data);
    check("the connector and its key are in the vault (sealed in the database)", vault?.url?.includes(String(connector.address().port)) && vault?.headers?.Authorization === `Bearer ${CONNECTOR_KEY}`, JSON.stringify(vault && { ...vault, headers: Object.keys(vault.headers || {}) }));
    const rawVault = (await db.query("SELECT data::text AS t FROM cloud_vault WHERE user_id = $1", [USER])).rows.map((r) => r.t).join("");
    check("…and the database never holds the key in clear", rawVault.length > 0 && !rawVault.includes(CONNECTOR_KEY));

    // ---- 2) the phone, desktop on: the desktop answers ----
    let r = await site("POST", "/api/v1/cloud/jobs", { chatId: dm, kind: "message", payload: { text: "PHONE-one are you there?" } });
    check("the phone sends a message (a job)", r.status === 200 && r.j?.jobId, JSON.stringify(r.j));
    let j = await waitFor("the desktop runs the phone's message", finished(r.j.jobId), 90_000);
    check("with the desktop on, the desktop claims and answers it", j?.status === "done" && /^desktop:/.test(j.claimed_by || ""), JSON.stringify(j));
    await app("POST", "/api/cloud", { action: "sync" });
    check("the answer is on the website for the phone", !!(await waitFor("answer on the website", async () => texts(await cloudChat(dm)).includes("REPLY PHONE-one"), 30_000)));

    // ---- 3) the desktop is off: the runner answers, with the connector from the vault ----
    await stopApp();
    startRunner();
    r = await site("POST", "/api/v1/cloud/jobs", { chatId: dm, kind: "message", payload: { text: "PHONE-two CONNECTOR what does my note say?" } });
    j = await waitFor("the runner runs it", finished(r.j.jobId), 120_000);
    check(`the runner claims and answers it (${process.env.RUNNER_IMAGE ? "Docker image" : "Node"})`, j?.status === "done" && /^runner:int-runner$/.test(j.claimed_by || ""), JSON.stringify(j));
    let chat = await cloudChat(dm);
    const answer = texts(chat).find((t) => /CONNECTOR-ANSWER|NO-CONNECTOR/.test(t)) || "";
    check("the runner installed the connector exactly as the desktop wrote it to the vault, and called it with its key", /CONNECTOR-ANSWER[\s\S]*MCP-RESULT-42/.test(answer) && connectorCalls > 0, answer);
    check("the phone sees the runner's answer through GET /chats", texts(chat).includes("PHONE-two CONNECTOR what does my note say?"));
    check("the runner's theOovi calls are billed to the account", Number((await db.query("SELECT balance_mc FROM credit_accounts WHERE user_id = $1", [USER])).rows[0].balance_mc) < 1000 * 1000);

    // ---- 4) needs the computer: the runner says so, the desktop picks it up later ----
    r = await site("POST", "/api/v1/cloud/jobs", { chatId: dm, kind: "message", payload: { text: "NEEDPC lis mon fichier notes.txt et je veux un résumé" } });
    const needId = r.j.jobId;
    j = await waitFor("the runner says it needs the computer", async () => ((await job(needId))?.status === "needs_computer" ? job(needId) : null), 120_000);
    check("a step that needs the computer: the job is left for the desktop (needs_computer)", j?.status === "needs_computer", JSON.stringify(await job(needId)));
    chat = await cloudChat(dm);
    check("…and the bot said so in the user's language (French)", texts(chat).some((t) => /ordinateur/.test(t) && /oovi/.test(t)), JSON.stringify(texts(chat).slice(-2)));
    await stopRunner();

    // ---- the runner API on the real website: fairness (exclude) and release ----
    const rapi = (p2, body) => fetch(`${SITE}/api/v1/cloud/runner${p2}`, { method: "POST", headers: { "x-oovi-runner": RUNNER_SECRET, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, j: await x.json().catch(() => null) }));
    const probe = (await site("POST", "/api/v1/cloud/jobs", { chatId: dm, kind: "message", payload: { text: "PHONE-probe" } })).j.jobId;
    await sleep(6000); // the runner waits 5 s before taking a job
    check("claim skips an account the runner says is busy (exclude)", (await rapi("/claim", { runnerId: "probe-runner", exclude: [USER] })).j?.job === null);
    const got = (await rapi("/claim", { runnerId: "probe-runner" })).j?.job;
    check("…and gives it without exclude (jobId, userId)", got?.jobId === probe && got?.userId === USER, JSON.stringify(got && { jobId: got.jobId, userId: got.userId }));
    check("another runner can't release it", (await rapi(`/jobs/${probe}/release`, { runnerId: "other-runner" })).status === 409);
    check("its runner releases it: back in the queue", (await rapi(`/jobs/${probe}/release`, { runnerId: "probe-runner" })).status === 200 && (await job(probe)).status === "queued");
    check("the runner API refuses a wrong secret", (await fetch(`${SITE}/api/v1/cloud/runner/claim`, { method: "POST", headers: { "x-oovi-runner": "wrong", "content-type": "application/json" }, body: JSON.stringify({ runnerId: "x" }) })).status === 401);
    await db.query("DELETE FROM cloud_job WHERE id = $1", [probe]);

    await startApp();
    j = await waitFor("the desktop runs the job left for it", async () => (["done", "failed"].includes((await job(needId))?.status) ? job(needId) : null), 120_000);
    check("the desktop, back on, picks up the needs_computer job and runs it", j?.status === "done" && /^desktop:/.test(j.claimed_by || ""), JSON.stringify(await job(needId)));
    await app("POST", "/api/cloud", { action: "sync" });
    const finalChat = await waitFor("the computer's answer on the website", async () => {
      const c = await cloudChat(dm);
      return texts(c).includes("DONE-ON-THE-COMPUTER") ? c : null;
    }, 60_000);
    const asked = texts(finalChat).filter((t) => t.startsWith("NEEDPC"));
    check("the computer's answer reaches the phone", !!finalChat);
    check("the message shows once, and the cloud's 'needs your computer' reply is replaced by the real answer", asked.length === 1 && !texts(finalChat).some((t) => /ordinateur pour ça/.test(t)), JSON.stringify(texts(finalChat).slice(-4)));
    const local = (await app("GET", `/api/chats/${dm}`)).j;
    check("the desktop's own copy matches", texts(local).filter((t) => t.startsWith("NEEDPC")).length === 1 && texts(local).includes("DONE-ON-THE-COMPUTER"));

    // ---- 5) routines while the computer is off (owner, 2026-11-19) ----
    // Telegram connected (the website keeps the bot's token, as the desktop registers it).
    const tgOn = await site("POST", "/api/v1/telegram/relay", { token: "123456789:AAH-stand-in-token-for-tests-0123456789", chats: [555], language: "en", config: { chatId: 555 }, connectedAt: Date.now() });
    check("Telegram is connected for the account (the website keeps its token)", tgOn.status < 300, JSON.stringify(tgOn.j));
    const made = await app("POST", "/api/routines", { name: "Morning check", botId: oovi.id, prompt: "PHONE-morning give me my morning check", schedule: { kind: "daily", time: "08:00" }, timezone: "Africa/Algiers", enabled: true, notifyTelegram: true });
    check("a daily routine is made on the computer", made.status === 201 && made.j?.id, JSON.stringify(made.j));
    const rid = made.j.id;
    const published = await waitFor("the computer tells the website its routine", async () => (await db.query("SELECT chat_id, due_at, time_zone FROM cloud_routine WHERE user_id = $1 AND routine_id = $2", [USER, rid])).rows[0], 60_000);
    check("the computer tells the website when the routine runs next, and its time zone", !!published?.due_at && published.time_zone === "Africa/Algiers", JSON.stringify(published));
    const rChat = published.chat_id;
    await stopApp();
    // The computer stays off past the routine's time (made due now here; the schedule's own maths are unit-tested).
    await db.query("UPDATE cloud_routine SET due_at = now() - interval '1 minute' WHERE user_id = $1 AND routine_id = $2", [USER, rid]);
    const tgBefore = tgSent.length;
    startRunner();
    const rj = await waitFor("the cloud server runs the routine", async () => (await db.query("SELECT id, status, claimed_by, error FROM cloud_job WHERE user_id = $1 AND kind = 'routine' AND status IN ('done', 'failed')", [USER])).rows[0], 120_000);
    check("computer off: the routine runs on the cloud server", rj?.status === "done" && /^runner:/.test(rj.claimed_by || ""), JSON.stringify(rj));
    const rRow = (await db.query("SELECT due_at, ran_at, ran_status FROM cloud_routine WHERE user_id = $1 AND routine_id = $2", [USER, rid])).rows[0];
    check("…recorded, with its next time (tomorrow at 08:00, Algiers) so it keeps running while the computer stays off", rRow?.ran_status === "ok" && !!rRow.ran_at && new Date(rRow.due_at) > new Date() && new Date(rRow.due_at).getUTCHours() === 7, JSON.stringify(rRow));
    const rCloud = await waitFor("the result in the routine's chat on the website", async () => {
      const c = await cloudChat(rChat);
      return texts(c).includes("REPLY PHONE-morning") ? c : null;
    }, 30_000);
    check("the result is in the routine's own chat (the computer's chat id), for the phone and the computer", !!rCloud);
    const tgMsg = tgSent.slice(tgBefore).find((m) => /Morning check/.test(m.text || ""));
    check("…and on the user's Telegram, sent by the website", !!tgMsg && tgMsg.chat_id === 555 && /REPLY PHONE-morning/.test(tgMsg.text), JSON.stringify(tgSent.slice(tgBefore)));
    const modelCalls = calls.length;
    await stopRunner();
    await startApp();
    const back = await waitFor("the computer marks the cloud's run", async () => {
      const r2 = (await app("GET", "/api/routines")).j;
      const one = (Array.isArray(r2) ? r2 : r2?.routines || []).find((x) => x.id === rid);
      return one?.lastRun?.note === "cloud" ? one : null;
    }, 60_000);
    check("the computer, back on, marks the run the cloud did (no second run)", !!back, JSON.stringify(back && back.lastRun));
    await sleep(8000); // a few more checks of the computer's routines
    const localR = (await app("GET", `/api/chats/${rChat}`)).j;
    await app("POST", "/api/cloud", { action: "sync" });
    check("…the routine ran once: one result, and no new model call from the computer", texts(localR).filter((t) => t === "REPLY PHONE-morning").length <= 1 && calls.slice(modelCalls).every((x) => !/PHONE-morning/.test(x.ask)), JSON.stringify({ texts: texts(localR), newCalls: calls.length - modelCalls }));
    check("…and its next run is tomorrow", back && back.nextRunAt > Date.now(), JSON.stringify(back && back.nextRunAt));
    // A routine that needs the computer (it watches a page): never run in the cloud; the user is told at its time, in
    // their language, and the Routines page says so in advance.
    const watched = await app("POST", "/api/routines", { name: "Price watch", botId: oovi.id, prompt: "PHONE-watch tell me if the price changed", schedule: { kind: "daily", time: "09:00" }, timezone: "Africa/Algiers", enabled: true, watch: { url: "https://example.com/" } });
    check("a routine that watches a page is made", watched.status === 201, JSON.stringify(watched.j));
    const page = (await app("GET", "/api/routines")).j.routines;
    const wv = page.find((x) => x.id === watched.j.id);
    const mv = page.find((x) => x.id === rid);
    check("the Routines page says where each runs when the computer is off (cloud / needs this computer, and why)", mv?.whenOff?.where === "cloud" && wv?.whenOff?.where === "computer" && wv.whenOff.why === "watch", JSON.stringify({ m: mv?.whenOff, w: wv?.whenOff }));
    const wRow = await waitFor("the computer lists it as waiting for the computer", async () => (await db.query("SELECT cloud, why FROM cloud_routine WHERE user_id = $1 AND routine_id = $2", [USER, watched.j.id])).rows[0], 60_000);
    check("…and tells the website it waits for the computer, with why", wRow?.cloud === false && wRow.why === "watch", JSON.stringify(wRow));
    await stopApp();
    await db.query("UPDATE cloud_routine SET due_at = now() - interval '1 minute' WHERE user_id = $1 AND routine_id = $2", [USER, watched.j.id]);
    const tg2 = tgSent.length;
    startRunner();
    const notice = await waitFor("the user is told it waits for the computer", async () => tgSent.slice(tg2).find((m) => /Price watch/.test(m.text || "")), 60_000);
    check("computer off at its time: the user is told on Telegram, in their language (French here, as they last wrote), why and when it will run", !!notice && /computer is off|ordinateur est éteint|حاسوبك مطفأ/.test(notice.text) && /compares a web page|compare une page web|يقارن صفحة ويب/.test(notice.text) && /as soon as you open oovi|dès que vous ouvrirez oovi|فور فتحك oovi/.test(notice.text), notice?.text);
    check("…and it is not run in the cloud", !(await db.query("SELECT 1 FROM cloud_job WHERE user_id = $1 AND kind = 'routine' AND payload::text <> '{}' AND status = 'queued'", [USER])).rowCount && !calls.some((x) => /PHONE-watch/.test(x.ask)));
    await stopRunner();
    await startApp();

    // ---- logs ----
    const leaks = ["PHONE-two", "PHONE-morning", "NEEDPC", "MCP-RESULT", CONNECTOR_KEY, RUNNER_SECRET, TOKEN].filter((w) => out.includes(w));
    check("the runner's logs carry no chat text, keys or tokens", leaks.length === 0, leaks.join(", "));
  } catch (e) {
    check("no crash", false, e.stack);
  } finally {
    for (const p of [appProc, runnerProc, webProc]) if (p && p.exitCode === null) p.kill("SIGTERM");
    model.close();
    connector.close();
    telegram.close();
    await db.query(`DELETE FROM "user" WHERE id = $1`, [USER]).catch(() => {});
    await db.end();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})();
