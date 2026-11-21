// oovi cloud (docs/CLOUD-BUILD.md) end to end against a LOCAL copy of the website and a THROWAWAY database.
// Never against the real database: it refuses any database that isn't on this machine.
//
//   1. A throwaway Postgres on this machine, e.g. (Linux):
//        initdb -D /var/tmp/pg -A trust -U postgres && pg_ctl -D /var/tmp/pg -o "-p 55432" start
//        psql -h 127.0.0.1 -p 55432 -U postgres -c "create database oovi_test"
//   2. Build the site: cd web && BETTER_AUTH_SECRET=local-test-secret-0123456789abcdef npm run build
//   3. TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/oovi_test node scripts/test-cloud.cjs
// It runs scripts/migrate.mjs, adds three test accounts with sessions, starts the built site (next start) with a
// stand-in for the AI provider, runs the checks and stops everything. Prints PASS/FAIL per check.
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const DB = process.env.TEST_DATABASE_URL;
if (!DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database on this machine.");
const host = new URL(DB).hostname;
if (!["127.0.0.1", "localhost", "::1", ""].includes(host)) throw new Error(`Refusing ${host}: only a database on this machine.`);
const WEB = path.join(__dirname, "..");
const PORT = 3591;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNNER = "r".repeat(48);
const MARK = "PLAINTEXT-MARKER-7f3a"; // must never appear in the database or the server's logs
const db = new Pool({ connectionString: DB });
let OAUTH = "";

let fails = 0;
let passes = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (ok) passes++;
  else fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, { token, body, headers = {}, runner } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (runner !== undefined) h["x-oovi-runner"] = runner;
  if (body !== undefined) h["content-type"] = "application/json";
  return fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    cache: r.headers.get("cache-control"),
    body: await r.json().catch(() => null),
  }));
}

async function addUser(id, email, { credits = true } = {}) {
  await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, now(), now())`, [id, `Test ${id}`, email]);
  const token = crypto.randomBytes(24).toString("hex");
  await db.query(`INSERT INTO session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, now() + interval '1 day', now(), now())`, [`s_${id}`, token, id]);
  if (credits) await db.query("INSERT INTO credit_accounts (user_id, balance_mc) VALUES ($1, $2)", [id, 1000 * 1000]).catch(async () => {});
  return token;
}

// A stand-in for the AI provider: answers every call with fixed usage.
let aiCalls = 0;
const mock = http.createServer((rq, rs) => {
  let n = 0;
  rq.on("data", (c) => (n += c.length));
  rq.on("end", () => {
    aiCalls++;
    rs.writeHead(200, { "content-type": "application/json" });
    rs.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text: "hello" }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200 } }));
  });
});

// A stand-in Telegram Bot API: records what the site asks of it.
const tgCalls = [];
const tgMock = http.createServer((rq, rs) => {
  let body = "";
  rq.on("data", (c) => (body += c));
  rq.on("end", () => {
    const method = rq.url.split("/").pop();
    let b = {};
    try {
      b = JSON.parse(body || "{}");
    } catch {}
    tgCalls.push({ method, body: b });
    rs.writeHead(200, { "content-type": "application/json" });
    rs.end(JSON.stringify({ ok: true, result: method === "getMe" ? { id: 1, username: "test_bot" } : true }));
  });
});

// A stand-in MCP service with OAuth (discovery, dynamic registration, PKCE), like Notion's or Linear's.
const codes = new Map(); // code -> {challenge, clientId, redirect}
const oauthMock = http.createServer((rq, rs) => {
  const o = `http://${rq.headers.host}`;
  const u = new URL(rq.url, o);
  let body = "";
  rq.on("data", (c) => (body += c));
  rq.on("end", () => {
    const send = (status, obj) => {
      rs.writeHead(status, { "content-type": "application/json" });
      rs.end(JSON.stringify(obj));
    };
    if (u.pathname.startsWith("/.well-known/oauth-protected-resource")) return send(200, { resource: `${o}/mcp`, authorization_servers: [o] });
    if (u.pathname.startsWith("/.well-known/oauth-authorization-server") || u.pathname.startsWith("/.well-known/openid-configuration"))
      return send(200, { issuer: o, authorization_endpoint: `${o}/authorize`, token_endpoint: `${o}/token`, registration_endpoint: `${o}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    if (u.pathname === "/register") {
      const meta = JSON.parse(body);
      return send(201, { ...meta, client_id: `cid-${crypto.randomBytes(4).toString("hex")}` });
    }
    if (u.pathname === "/token") {
      const f = new URLSearchParams(body);
      const c = codes.get(f.get("code"));
      const ok = c && f.get("grant_type") === "authorization_code" && crypto.createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === c.challenge && f.get("redirect_uri") === c.redirect;
      if (!ok) return send(400, { error: "invalid_grant" });
      codes.delete(f.get("code"));
      return send(200, { access_token: `${MARK}-access`, refresh_token: "refresh-1", token_type: "Bearer", expires_in: 3600 });
    }
    if (u.pathname === "/mcp") {
      rs.writeHead(401, { "www-authenticate": `Bearer resource_metadata="${o}/.well-known/oauth-protected-resource/mcp"` });
      return rs.end();
    }
    send(404, {});
  });
});
/** What the person's browser does on the service's page: approve, and get sent back with a code. */
function approve(authUrl) {
  const a = new URL(authUrl);
  const code = `code-${crypto.randomBytes(6).toString("hex")}`;
  codes.set(code, { challenge: a.searchParams.get("code_challenge"), redirect: a.searchParams.get("redirect_uri") });
  return { code, state: a.searchParams.get("state"), redirect: a.searchParams.get("redirect_uri") };
}

async function main() {
  // ---- database ----
  const mig = spawnSync(process.execPath, ["scripts/migrate.mjs"], { cwd: WEB, env: { ...process.env, DATABASE_URL: DB, DATABASE_URL_UNPOOLED: DB }, encoding: "utf8" });
  check("migrate.mjs creates the cloud tables", mig.status === 0 && /cloud_chat, cloud_device, cloud_job, cloud_oauth_flow, cloud_routine, cloud_runner, cloud_sync, cloud_vault/.test(mig.stdout), (mig.stderr || mig.stdout).slice(-300));
  await db.query("DELETE FROM cloud_runner"); // a throwaway database kept from an earlier run
  await db.query(`DELETE FROM "user" WHERE id LIKE 'cloudtest_%'`);
  const A = await addUser("cloudtest_a", "a@cloud.test");
  const B = await addUser("cloudtest_b", "b@cloud.test");
  const C = await addUser("cloudtest_c", "c@cloud.test", { credits: false });
  await db.query("DELETE FROM credit_accounts WHERE user_id = 'cloudtest_c'");

  // ---- the site ----
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  await new Promise((r) => oauthMock.listen(0, "127.0.0.1", r));
  await new Promise((r) => tgMock.listen(0, "127.0.0.1", r));
  OAUTH = `http://127.0.0.1:${oauthMock.address().port}`;
  const env = {
    ...process.env,
    DATABASE_URL: DB,
    BETTER_AUTH_SECRET: "local-test-secret-0123456789abcdef",
    BETTER_AUTH_URL: BASE,
    RUNNER_SECRET: RUNNER,
    ADMIN_EMAILS: "a@cloud.test",
    ANTHROPIC_API_KEY: "test-key-not-real",
    OOVI_AI_UPSTREAM: `http://127.0.0.1:${mock.address().port}`,
    OOVI_CLOUD_POLL_MS: "3000",
    OOVI_CLOUD_OAUTH_TEST_HOSTS: new URL(OAUTH).host,
    OOVI_TELEGRAM_API: `http://127.0.0.1:${tgMock.address().port}`,
    NODE_ENV: "production",
  };
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [WEB] }), "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: WEB, env });
  let logs = "";
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${BASE}/api/v1/health`).then((r) => r.ok, () => false);
    if (up) break;
    await sleep(500);
  }

  try {
    await run(A, B, C);
  } finally {
    server.kill();
    mock.close();
    oauthMock.close();
    tgMock.close();
  }
  check("the server's logs never contain chat or sign-in text", !logs.includes(MARK), logs.includes(MARK) ? "marker found in logs" : "");
  const leaks = await db.query("SELECT (SELECT count(*) FROM cloud_chat WHERE data::text LIKE $1) + (SELECT count(*) FROM cloud_vault WHERE data::text LIKE $1) AS n", [`%${MARK}%`]);
  check("the database never holds chat text in clear", Number(leaks.rows[0].n) === 0);
  await db.query(`DELETE FROM "user" WHERE id LIKE 'cloudtest_%'`);
  await db.end();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

async function run(A, B, C) {
  const dev = (id) => ({ "x-oovi-device": id });

  // ---- signed out, sync off ----
  check("signed out: 401", (await req("GET", "/api/v1/cloud/status")).status === 401);
  check("a made-up token: 401", (await req("GET", "/api/v1/cloud/chats", { token: "nope" })).status === 401);
  let r = await req("GET", "/api/v1/cloud/status", { token: A, headers: dev("desktop:pcA") });
  check("status: off by default, 100 MB limit, no-store", r.status === 200 && r.body.enabled === false && r.body.limit === 100 * 1024 * 1024 && /no-store/.test(r.cache ?? ""), JSON.stringify(r.body));
  check("status lists the device that called (online)", r.body.devices?.some((d) => d.deviceId === "pcA" && d.kind === "desktop" && d.online));
  check("status says oovi's cloud server is not up before any runner asked for work", r.body.server?.online === false && r.body.server.lastSeen === null, JSON.stringify(r.body.server));
  r = await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: 0, chat: { id: "c1" } } });
  check("sync off: saving a chat is refused (sync_off)", r.status === 403 && r.body.code === "sync_off");
  check("a write from another website is refused", (await req("PUT", "/api/v1/cloud/status", { token: A, headers: { origin: "https://evil.example" }, body: { enabled: true } })).status === 403);
  check("a write from the site itself passes the origin check", (await req("PUT", "/api/v1/cloud/status", { token: A, headers: { origin: BASE }, body: { enabled: "x" } })).status === 400);
  check("PUT status needs a boolean", (await req("PUT", "/api/v1/cloud/status", { token: A, body: { enabled: "yes" } })).status === 400);
  r = await req("PUT", "/api/v1/cloud/status", { token: A, body: { enabled: true } });
  check("turn sync on", r.status === 200 && r.body.enabled === true);
  await req("PUT", "/api/v1/cloud/status", { token: B, body: { enabled: true } });

  // ---- chats ----
  const chat = { id: "c1", kind: "direct", name: "Plans", entries: [{ id: "e1", text: `${MARK} meet at 9`, updatedAt: 1 }], updatedAt: 1 };
  r = await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: 0, chat } });
  check("new chat saved as version 1", r.status === 200 && r.body.version === 1, JSON.stringify(r.body));
  r = await req("GET", "/api/v1/cloud/chats/c1", { token: A });
  check("read it back, the same", r.status === 200 && r.body.version === 1 && JSON.stringify(r.body.chat) === JSON.stringify(chat));
  const raw = await db.query("SELECT data::text AS t, bytes FROM cloud_chat WHERE user_id = 'cloudtest_a' AND chat_id = 'c1'");
  check("stored sealed (iv, tag, data), compressed size counted", /"iv"/.test(raw.rows[0].t) && /"tag"/.test(raw.rows[0].t) && raw.rows[0].bytes > 0 && !raw.rows[0].t.includes("meet at 9"));
  r = await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: 0, chat: { ...chat, name: "Other device" } } });
  check("an old base version: 409 with the server's copy to merge", r.status === 409 && r.body.code === "conflict" && r.body.version === 1 && r.body.chat?.name === "Plans");
  r = await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: 1, chat: { ...chat, name: "Merged" } } });
  check("after merging: version 2", r.status === 200 && r.body.version === 2);
  check("chat id must match the address", (await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: 2, chat: { id: "c9" } } })).status === 400);
  check("a bad chat id: 400", (await req("GET", "/api/v1/cloud/chats/a%20b", { token: A })).status === 400);
  check("broken JSON: 400", (await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: "{nope" })).status === 400);
  check("a chat over 4 MB: 413 too_big", (await req("PUT", "/api/v1/cloud/chats/big", { token: A, body: { baseVersion: 0, chat: { t: "x".repeat(4.2 * 1024 * 1024) } } })).body?.code === "too_big");

  // ---- isolation ----
  r = await req("GET", "/api/v1/cloud/chats/c1", { token: B });
  check("another account can't read it (404)", r.status === 404);
  r = await req("PUT", "/api/v1/cloud/chats/c1", { token: B, body: { baseVersion: 0, chat: { id: "c1", name: "B's own" } } });
  check("another account's chat with the same id is its own", r.status === 200 && r.body.version === 1);
  r = await req("GET", "/api/v1/cloud/chats/c1", { token: A });
  check("...and A's copy is untouched", r.body.chat?.name === "Merged");
  r = await req("GET", "/api/v1/cloud/chats", { token: B });
  check("B's list holds only B's chat", r.body.chats.length === 1 && r.body.chats[0].chatId === "c1" && r.body.chats[0].version === 1);
  r = await req("PUT", "/api/v1/cloud/chats/c1?userId=cloudtest_b", { token: A, body: { baseVersion: 2, chat: { id: "c1", userId: "cloudtest_b", name: "A again" } } });
  check("a userId in the address or body is ignored (A saves A's chat)", r.status === 200 && (await req("GET", "/api/v1/cloud/chats/c1", { token: B })).body.chat.name === "B's own");

  // ---- list since ----
  await sleep(6000); // `now` is 5 s early on purpose (a save that was finishing is listed again, never missed)
  r = await req("GET", "/api/v1/cloud/chats", { token: A });
  const since = r.body.now;
  check("list: no content, versions and sizes", r.status === 200 && r.body.chats.every((c) => !("chat" in c) && c.bytes > 0) && typeof since === "string");
  await req("PUT", "/api/v1/cloud/chats/c2", { token: A, body: { baseVersion: 0, chat: { id: "c2", name: "second" } } });
  r = await req("GET", `/api/v1/cloud/chats?since=${encodeURIComponent(since)}`, { token: A });
  check("list since: only what changed", r.body.chats.length === 1 && r.body.chats[0].chatId === "c2", JSON.stringify(r.body.chats.map((c) => c.chatId)));
  check("since must be a date", (await req("GET", "/api/v1/cloud/chats?since=yesterday", { token: A })).status === 400);
  r = await req("GET", "/api/v1/cloud/status", { token: A });
  check("status counts 2 chats and their bytes, last sync set", r.body.chats === 2 && r.body.bytes > 0 && !!r.body.lastSync);

  // ---- account limit ----
  await db.query("UPDATE cloud_sync SET bytes = $1 WHERE user_id = 'cloudtest_a'", [100 * 1024 * 1024 - 10]);
  r = await req("PUT", "/api/v1/cloud/chats/c3", { token: A, body: { baseVersion: 0, chat: { id: "c3", name: "over" } } });
  check("past 100 MB: 413 over_limit with bytes and limit", r.status === 413 && r.body.code === "over_limit" && r.body.limit === 100 * 1024 * 1024);
  r = await req("PUT", "/api/v1/cloud/chats/c2", { token: A, body: { baseVersion: 1, chat: { id: "c2" } } });
  check("a chat that gets smaller still saves when full", r.status === 200);
  const fix = await db.query("SELECT COALESCE(sum(bytes),0) AS b FROM cloud_chat WHERE user_id = 'cloudtest_a' AND NOT deleted");
  await db.query("UPDATE cloud_sync SET bytes = $1 WHERE user_id = 'cloudtest_a'", [Number(fix.rows[0].b)]);

  // ---- delete, tombstones ----
  r = await req("DELETE", "/api/v1/cloud/chats/c2", { token: A });
  check("delete: a new version", r.status === 200 && r.body.version === 3);
  const tomb = await db.query("SELECT data, bytes, deleted FROM cloud_chat WHERE user_id = 'cloudtest_a' AND chat_id = 'c2'");
  check("the tombstone keeps no content", tomb.rows[0].deleted === true && tomb.rows[0].data === null && tomb.rows[0].bytes === 0);
  r = await req("GET", "/api/v1/cloud/chats/c2", { token: A });
  check("reading a deleted chat: deleted, no chat", r.status === 200 && r.body.deleted === true && r.body.chat === null);
  check("delete unknown: 404", (await req("DELETE", "/api/v1/cloud/chats/nope", { token: A })).status === 404);
  r = await req("PUT", "/api/v1/cloud/chats/c2", { token: A, body: { baseVersion: 0, chat: { id: "c2" } } });
  check("re-creating over a tombstone needs its version (409, deleted)", r.status === 409 && r.body.deleted === true && r.body.version === 3);
  await db.query("UPDATE cloud_chat SET updated_at = now() - interval '31 days' WHERE user_id = 'cloudtest_a' AND chat_id = 'c2'");
  r = await req("GET", "/api/v1/cloud/chats", { token: A });
  check("tombstones older than 30 days are removed", !r.body.chats.some((c) => c.chatId === "c2"));
  r = await req("GET", "/api/v1/cloud/status", { token: A });
  check("status: 1 chat left", r.body.chats === 1);

  // ---- vault ----
  const signin = { kind: "oauth", access: `${MARK}-token`, refresh: "r1" };
  r = await req("PUT", "/api/v1/cloud/vault/mcp:gmail", { token: A, body: { baseVersion: 0, data: signin } });
  check("vault: save a connector's sign-in", r.status === 200 && r.body.version === 1);
  r = await req("GET", "/api/v1/cloud/vault/mcp:gmail", { token: A });
  check("vault: read it back", r.body.data?.refresh === "r1");
  check("vault: another account can't read it", (await req("GET", "/api/v1/cloud/vault/mcp:gmail", { token: B })).status === 404);
  r = await req("PUT", "/api/v1/cloud/vault/mcp:gmail", { token: A, body: { baseVersion: 0, data: {} } });
  check("vault: 409 on an old version", r.status === 409 && r.body.version === 1);
  r = await req("GET", "/api/v1/cloud/vault", { token: A });
  check("vault list: ids and versions, no data", r.body.items.length === 1 && r.body.items[0].connectorId === "mcp:gmail" && !("data" in r.body.items[0]));
  const vraw = await db.query("SELECT data::text AS t FROM cloud_vault WHERE user_id = 'cloudtest_a'");
  check("vault stored sealed", !vraw.rows[0].t.includes(MARK) && !vraw.rows[0].t.includes("oauth"));

  // ---- jobs ----
  check("job for an unknown chat: 404", (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "nope", kind: "message", payload: {} } })).status === 404);
  check("job of an unknown kind: 400", (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "shell", payload: {} } })).status === 400);
  r = await req("POST", "/api/v1/cloud/jobs", { token: A, headers: dev("phone:phA"), body: { chatId: "c1", kind: "message", payload: { text: `${MARK} from phone` } } });
  const j1 = r.body.jobId;
  check("the phone sends a message", r.status === 200 && /^[0-9a-f-]{36}$/.test(j1));
  check("B can't claim A's job", (await req("POST", "/api/v1/cloud/jobs/claim", { token: B, body: { deviceId: "pcB" } })).body.job === null);
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA", kind: "desktop" } });
  check("the desktop claims it with a 120 s lease", r.body.job?.jobId === j1 && r.body.job.payload.text.endsWith("from phone") && r.body.job.was === "queued" && new Date(r.body.job.leaseUntil) - Date.now() > 100_000);
  const j2 = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: { text: "second" } } })).body.jobId;
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA2" } });
  check("one chat, one claimer: another computer can't take the chat's next job", r.body.job === null);
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA", chatIds: ["other"] } });
  check("chatIds limits the claim", r.body.job === null);
  r = await req("POST", `/api/v1/cloud/jobs/${j1}/heartbeat`, { token: A, body: { deviceId: "pcA" } });
  check("heartbeat extends the lease", r.status === 200 && !!r.body.leaseUntil);
  check("heartbeat from another device: 409", (await req("POST", `/api/v1/cloud/jobs/${j1}/heartbeat`, { token: A, body: { deviceId: "pcA2" } })).status === 409);
  check("heartbeat from another account: 409", (await req("POST", `/api/v1/cloud/jobs/${j1}/heartbeat`, { token: B, body: { deviceId: "pcA" } })).status === 409);
  check("done with a bad status: 400", (await req("POST", `/api/v1/cloud/jobs/${j1}/done`, { token: A, body: { deviceId: "pcA", status: "claimed" } })).status === 400);
  r = await req("POST", `/api/v1/cloud/jobs/${j1}/done`, { token: A, body: { deviceId: "pcA", status: "done" } });
  check("done", r.status === 200);
  const pj = await db.query("SELECT payload::text AS p, status FROM cloud_job WHERE id = $1", [j1]);
  check("a finished job keeps no content", pj.rows[0].status === "done" && pj.rows[0].p === "{}");
  check("done twice: 409", (await req("POST", `/api/v1/cloud/jobs/${j1}/done`, { token: A, body: { deviceId: "pcA", status: "done" } })).status === 409);
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA2" } });
  check("the chat is free again: the next job is claimed", r.body.job?.jobId === j2);
  await req("POST", `/api/v1/cloud/jobs/${j2}/done`, { token: A, body: { deviceId: "pcA2", status: "done" } });
  // An ended lease: the job goes to the next claimer.
  const j3 = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: {} } })).body.jobId;
  await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA" } });
  await db.query("UPDATE cloud_job SET lease_until = now() - interval '1 second' WHERE id = $1", [j3]);
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA2" } });
  check("an ended lease: another device takes the job", r.body.job?.jobId === j3 && r.body.job.was === "claimed");
  check("...and the old holder's heartbeat is refused", (await req("POST", `/api/v1/cloud/jobs/${j3}/heartbeat`, { token: A, body: { deviceId: "pcA" } })).status === 409);
  await req("POST", `/api/v1/cloud/jobs/${j3}/done`, { token: A, body: { deviceId: "pcA2", status: "done" } });

  // Many claimers at once: each job goes to exactly one.
  for (let i = 0; i < 12; i++) await req("PUT", `/api/v1/cloud/chats/p${i}`, { token: A, body: { baseVersion: 0, chat: { id: `p${i}` } } });
  const made = [];
  for (let i = 0; i < 12; i++) made.push((await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: `p${i}`, kind: "message", payload: { n: i } } })).body.jobId);
  const got = await Promise.all(Array.from({ length: 16 }, (_, i) => req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: `race${i}` } })));
  const ids = got.map((g) => g.body?.job?.jobId).filter(Boolean);
  check("16 claimers at once: 12 jobs, each claimed once", ids.length === 12 && new Set(ids).size === 12 && made.every((m) => ids.includes(m)), `${ids.length} claimed, ${new Set(ids).size} distinct`);
  await db.query("UPDATE cloud_job SET status = 'done', payload = '{}' WHERE user_id = 'cloudtest_a' AND chat_id LIKE 'p%'");

  // ---- runner ----
  check("runner API without the header: 401", (await req("POST", "/api/v1/cloud/runner/claim", { body: { runnerId: "r1" } })).status === 401);
  check("runner API with a wrong secret: 401", (await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER + "x", body: { runnerId: "r1" } })).status === 401);
  check("a user session never opens the runner API", (await req("POST", "/api/v1/cloud/runner/claim", { token: A, body: { runnerId: "r1" } })).status === 401);
  const j4 = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: { text: "for the runner" } } })).body.jobId;
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [j4]);
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  check("runner waits while a desktop of the account is online", r.status === 200 && r.body.job === null);
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '5 minutes' WHERE user_id = 'cloudtest_a' AND kind = 'desktop'");
  const j5 = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: {} } })).body.jobId;
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  check("no desktop online, job older than 2 s: the runner takes it (with the account id)", r.body.job?.jobId === j4 && r.body.job.userId === "cloudtest_a" && r.body.job.payload.text === "for the runner");
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r2" } });
  check("a job younger than 2 s waits", r.body.job === null || r.body.job.jobId !== j5);
  r = await req("GET", "/api/v1/cloud/status", { token: A });
  check("status says oovi's cloud server is up once a runner asked for work", r.body.server?.online === true && !!r.body.server.lastSeen, JSON.stringify(r.body.server));
  r = await req("POST", `/api/v1/cloud/runner/jobs/${j4}/heartbeat`, { runner: RUNNER, body: { runnerId: "r1" } });
  check("runner heartbeat", r.status === 200 && !r.body.stop);
  // Stop from the phone while the runner works on that chat: it comes back with the heartbeat (the runner asks
  // for no new job while it is busy), once, and the stop job is done.
  const jStop = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "stop", payload: {} } })).body.jobId;
  r = await req("POST", `/api/v1/cloud/runner/jobs/${j4}/heartbeat`, { runner: RUNNER, body: { runnerId: "r1" } });
  check("a Stop sent from the phone reaches the runner with its heartbeat", r.status === 200 && r.body.stop === true, JSON.stringify(r.body));
  check("...and that stop job is done", (await db.query("SELECT status FROM cloud_job WHERE id = $1", [jStop])).rows[0]?.status === "done");
  r = await req("POST", `/api/v1/cloud/runner/jobs/${j4}/heartbeat`, { runner: RUNNER, body: { runnerId: "r1" } });
  check("...and it is said once", r.status === 200 && !r.body.stop);
  // The runner's key opens an account only while a runner holds a job of it.
  check("runner: no chat of an account it runs no job for", (await req("GET", "/api/v1/cloud/runner/chats/cloudtest_b/c1", { runner: RUNNER })).status === 403);
  check("runner: no sign-in of an account it runs no job for", (await req("GET", "/api/v1/cloud/runner/vault/cloudtest_b/mcp:gmail", { runner: RUNNER })).status === 403);
  check("runner: no setup of an account it runs no job for", (await req("GET", "/api/v1/cloud/runner/setup/cloudtest_b", { runner: RUNNER })).status === 403);
  check("runner: no Telegram message to an account it runs no job for", (await req("POST", "/api/v1/cloud/runner/telegram", { runner: RUNNER, body: { userId: "cloudtest_b", text: "hi" } })).status === 403);
  r = await req("GET", "/api/v1/cloud/runner/chats/cloudtest_a/c1", { runner: RUNNER });
  check("runner reads the job's chat", r.status === 200 && r.body.chat?.name === "A again");
  r = await req("PUT", "/api/v1/cloud/runner/chats/cloudtest_a/c1", { runner: RUNNER, body: { baseVersion: r.body.version, chat: { ...r.body.chat, name: "by runner" } } });
  check("runner saves the chat with its version", r.status === 200);
  r = await req("GET", "/api/v1/cloud/runner/vault/cloudtest_a/mcp:gmail", { runner: RUNNER });
  check("runner reads a connector's sign-in", r.body.data?.refresh === "r1");
  r = await req("PUT", "/api/v1/cloud/runner/vault/cloudtest_a/mcp:gmail", { runner: RUNNER, body: { baseVersion: 1, data: { ...signin, refresh: "r2" } } });
  check("runner saves a refreshed sign-in", r.status === 200 && r.body.version === 2);
  check("runner paths need a valid account id", (await req("GET", "/api/v1/cloud/runner/chats/a:b/c1", { runner: RUNNER })).status === 400);
  r = await req("POST", `/api/v1/cloud/runner/jobs/${j4}/done`, { runner: RUNNER, body: { runnerId: "r1", status: "needs_computer", error: "needs the computer's files" } });
  check("runner leaves a job for the computer", r.status === 200);
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [j5]);
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  check("the runner never takes a needs_computer job back", r.body.job?.jobId !== j4);
  if (r.body.job) await req("POST", `/api/v1/cloud/runner/jobs/${r.body.job.jobId}/done`, { runner: RUNNER, body: { runnerId: "r1", status: "done" } });
  r = await req("POST", "/api/v1/cloud/jobs/claim", { token: A, body: { deviceId: "pcA" } });
  check("the desktop picks it up when it opens (was needs_computer, payload kept)", r.body.job?.jobId === j4 && r.body.job.was === "needs_computer" && r.body.job.payload.text === "for the runner");
  await req("POST", `/api/v1/cloud/jobs/${j4}/done`, { token: A, body: { deviceId: "pcA", status: "done" } });
  check("runner: once its job ended, the account's chats are closed to it again", (await req("GET", "/api/v1/cloud/runner/chats/cloudtest_a/c1", { runner: RUNNER })).status === 403);

  // A job whose runner dies each time (the lease runs out) is tried three times, then given up: it used to be
  // taken again for ever.
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '5 minutes' WHERE user_id = 'cloudtest_a' AND kind = 'desktop'");
  const jLoop = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: { text: "kills its runner" } } })).body.jobId;
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [jLoop]);
  let taken = 0;
  for (let i = 0; i < 5; i++) {
    r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
    if (r.body.job?.jobId !== jLoop) break;
    taken++;
    await db.query("UPDATE cloud_job SET lease_until = now() - interval '1 second' WHERE id = $1", [jLoop]);
  }
  const loop = (await db.query("SELECT status, error FROM cloud_job WHERE id = $1", [jLoop])).rows[0];
  check("a job that keeps losing its runner is tried three times, then ends as failed", taken === 3 && loop?.status === "failed" && loop.error === "gave_up", `${taken} ${JSON.stringify(loop)}`);
  // A job held for the AI checks below.
  const jAi = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: { text: "ai" } } })).body.jobId;
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [jAi]);
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  check("(a job of account A is held by the runner for the AI checks)", r.body.job?.jobId === jAi, JSON.stringify(r.body).slice(0, 200));

  // ---- runner AI (theOovi, billed to the account) ----
  const ai = { max_tokens: 100, messages: [{ role: "user", content: "hi" }] };
  const before = Number((await db.query("SELECT balance_mc FROM credit_accounts WHERE user_id = 'cloudtest_a'")).rows[0].balance_mc);
  r = await req("POST", "/api/v1/cloud/runner/ai/cloudtest_a", { runner: RUNNER, body: ai });
  const after = Number((await db.query("SELECT balance_mc FROM credit_accounts WHERE user_id = 'cloudtest_a'")).rows[0].balance_mc);
  check("runner AI answers as theOovi and bills that account", r.status === 200 && r.body.content?.[0]?.text === "hello" && r.body.oovi?.credits > 0 && after < before, `${r.status} ${JSON.stringify(r.body).slice(0, 200)} ${before}->${after}`);
  check("runner AI without the secret: 401", (await req("POST", "/api/v1/cloud/runner/ai/cloudtest_a", { token: A, body: ai })).status === 401);
  await req("PUT", "/api/v1/cloud/status", { token: C, body: { enabled: true } });
  r = await req("POST", "/api/v1/cloud/runner/ai/cloudtest_c", { runner: RUNNER, body: ai });
  check("runner AI for an account it runs no job for: refused", r.status === 403);
  const jC = (await req("POST", "/api/v1/cloud/jobs", { token: C, body: { chatId: "cc", kind: "message", payload: { text: "c" } } })).body.jobId;
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [jC]);
  r = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r2" } });
  r = await req("POST", "/api/v1/cloud/runner/ai/cloudtest_c", { runner: RUNNER, body: ai });
  check("runner AI for an account without credits set up: refused", r.status === 403, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  await req("POST", `/api/v1/cloud/runner/jobs/${jC}/done`, { runner: RUNNER, body: { runnerId: "r2", status: "failed", error: "no_credits" } });
  r = await req("POST", "/api/v1/cloud/runner/ai/cloudtest_b_off", { runner: RUNNER, body: ai });
  check("runner AI for an account that doesn't sync: refused", r.status === 403);
  await req("POST", `/api/v1/cloud/runner/jobs/${jAi}/done`, { runner: RUNNER, body: { runnerId: "r1", status: "done" } });
  const signed = await req("POST", "/api/v1/ai/messages", { token: A, body: ai });
  check("the desktop's theOovi route still works after the move", signed.status === 200 && signed.body.content?.[0]?.text === "hello");

  // ---- Telegram while the computer is off: oovi's cloud server answers it ----
  const TG_TOKEN = `123456789:${"A".repeat(35)}`;
  await req("PUT", "/api/v1/cloud/chats/dm-main1", { token: A, body: { baseVersion: 0, chat: { id: "dm-main1", kind: "direct", name: "", memberIds: ["main1"], entries: [] } } });
  r = await req("POST", "/api/v1/telegram/relay", { token: A, body: { token: TG_TOKEN, chats: [777], language: "ar", config: { chatId: 777, mainChat: "dm-main1" }, connectedAt: Date.now() } });
  check("Telegram: the relay is registered", r.status === 200, JSON.stringify(r.body));
  const hook = (await db.query("SELECT hook_id, secret FROM telegram_relays WHERE user_id = 'cloudtest_a'")).rows[0];
  const tgHook = (update) => fetch(`${BASE}/api/v1/telegram/hook/${hook.hook_id}`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": hook.secret }, body: JSON.stringify(update) });
  // The computer is off (no desktop seen, the relay never polled), and the cloud server is up.
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '5 minutes' WHERE user_id = 'cloudtest_a' AND kind = 'desktop'");
  await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1", exclude: ["cloudtest_a"] } });
  const jobsOf = async () => (await db.query("SELECT id, status FROM cloud_job WHERE user_id = 'cloudtest_a' AND chat_id = 'dm-main1' ORDER BY created_at")).rows;
  const tgBefore = tgCalls.length;
  check("Telegram: the webhook answers", (await tgHook({ update_id: 900, message: { chat: { id: 777 }, text: "مرحبا من تيليغرام" } })).status === 200);
  let tj = await jobsOf();
  check("Telegram, computer off: the message becomes a job for oovi's cloud server in the main bot's chat", tj.length === 1 && tj[0].status === "queued", JSON.stringify(tj));
  check("…it no longer waits for the computer (nothing left in the inbox)", Number((await db.query("SELECT count(*) AS n FROM telegram_inbox WHERE user_id = 'cloudtest_a'")).rows[0].n) === 0);
  const newTg = tgCalls.slice(tgBefore).map((c) => c.method);
  check("…the user sees 'typing', not 'open oovi on your computer'", newTg.includes("sendChatAction") && !newTg.includes("sendMessage"), newTg.join(","));
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE user_id = 'cloudtest_a' AND chat_id = 'dm-main1'");
  const claimedTg = await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  const p = claimedTg.body.job?.payload ?? {};
  check("…the runner gets it with where the answer goes", claimedTg.body.job?.chatId === "dm-main1" && p.channel === "telegram" && p.telegramChatId === 777 && p.entryId === "tg900", JSON.stringify(p));
  if (claimedTg.body.job) await req("POST", `/api/v1/cloud/runner/jobs/${claimedTg.body.job.jobId}/done`, { runner: RUNNER, body: { runnerId: "r1", status: "done" } });
  await tgHook({ update_id: 900, message: { chat: { id: 777 }, text: "مرحبا من تيليغرام" } });
  check("Telegram sends the same update again: no second job", (await jobsOf()).length === 1);
  // A message from a group chat linked to oovi stays with the computer.
  await tgHook({ update_id: 901, message: { chat: { id: 888 }, text: "from a group" } });
  check("a linked group chat's message is not handed to the cloud", (await jobsOf()).length === 1);
  // The computer comes back: the next message waits for it, as before.
  await req("GET", "/api/v1/cloud/status", { token: A, headers: dev("desktop:pcA") });
  await tgHook({ update_id: 902, message: { chat: { id: 777 }, text: "computer is on now" } });
  check("computer on: the message waits for the computer, not the cloud", (await jobsOf()).length === 1 && Number((await db.query("SELECT count(*) AS n FROM telegram_inbox WHERE user_id = 'cloudtest_a'")).rows[0].n) >= 1);
  await db.query("DELETE FROM telegram_inbox WHERE user_id = 'cloudtest_a'");
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '5 minutes' WHERE user_id = 'cloudtest_a' AND kind = 'desktop'");

  // ---- events (long-poll) ----
  let t = Date.now();
  r = await req("GET", "/api/v1/cloud/events?chatId=c1&after=1", { token: A });
  check("events: a newer version answers at once", r.status === 200 && r.body.changed === true && r.body.version > 1 && Date.now() - t < 2500);
  const v = r.body.version;
  t = Date.now();
  r = await req("GET", `/api/v1/cloud/events?chatId=c1&after=${v}`, { token: A });
  check("events: nothing new → changed=false after the wait", r.body.changed === false && Date.now() - t >= 2500, `${Date.now() - t} ms ${JSON.stringify(r.body)}`);
  t = Date.now();
  const waiting = req("GET", `/api/v1/cloud/events?chatId=c1&after=${v}`, { token: A });
  await sleep(800);
  await req("PUT", "/api/v1/cloud/chats/c1", { token: A, body: { baseVersion: v, chat: { id: "c1", name: "new step" } } });
  r = await waiting;
  check("events: a save while waiting wakes the phone", r.body.changed === true && r.body.version === v + 1 && Date.now() - t < 3000);
  const ja = new Date().toISOString();
  const waitJob = req("GET", `/api/v1/cloud/events?chatId=c1&after=${v + 1}&jobsAfter=${encodeURIComponent(ja)}`, { token: A });
  await sleep(300);
  const j6 = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "stop", payload: {} } })).body.jobId;
  r = await waitJob;
  check("events: a job change wakes it too, with the chat's jobs", r.body.changed === true && r.body.jobs.some((j) => j.jobId === j6 && j.status === "queued" && j.kind === "stop"));
  check("events: another account's chat → nothing", (await req("GET", "/api/v1/cloud/events?chatId=c1&after=0", { token: B })).body.version === 1);
  check("events: bad query → 400", (await req("GET", "/api/v1/cloud/events?chatId=c1&after=x", { token: A })).status === 400);

  // ---- admin ----
  const page = await fetch(`${BASE}/admin/users`, { headers: { authorization: `Bearer ${A}` } });
  const html = await page.text();
  check("Admin > Users: Syncs column with chats and size", page.status === 200 && html.includes("Syncs") && /Yes · \d+ chats · /.test(html), `status ${page.status}`);
  check("Admin > Users: never chat content", !html.includes(MARK) && !html.includes("by runner"));
  const detail = await (await fetch(`${BASE}/admin/users/cloudtest_a`, { headers: { authorization: `Bearer ${A}` } })).text();
  check("Admin > a user: Cloud sync section, devices, no content", detail.includes("Cloud sync") && detail.includes("Computer") && !detail.includes(MARK) && !detail.includes("by runner"));
  const over = await (await fetch(`${BASE}/admin`, { headers: { authorization: `Bearer ${A}` } })).text();
  check("Admin > Overview: the sync count", over.includes("Cloud sync") && over.includes("Accounts syncing their chats"));
  check("Admin > Overview: whether oovi's cloud server is up, and its queue", over.includes("Cloud server") && /waiting/.test(over) && /failed in the last day/.test(over));
  check("Admin pages: not for other accounts (404)", (await fetch(`${BASE}/admin/users`, { headers: { authorization: `Bearer ${B}` } })).status === 404);

  // ---- privacy page ----
  const priv = await (await fetch(`${BASE}/privacy`)).text();
  check("privacy page has the cloud sync section", priv.includes("Optional cloud sync") && priv.includes("never shows the") && priv.includes("Turning it off"));

  // ---- connectors signed in from the phone ----
  const cb = (q, token = A) => fetch(`${BASE}/api/v1/cloud/connectors/oauth/callback?${new URLSearchParams(q)}`, { redirect: "manual", headers: token ? { authorization: `Bearer ${token}` } : {} }).then((x) => x.headers.get("location") ?? `status ${x.status}`);
  const start = (id, body = {}, token = A) => req("POST", `/api/v1/cloud/connectors/${id}/oauth/start`, { token, body });
  r = await req("PUT", "/api/v1/cloud/vault/mcp:keyed", { token: A, body: { baseVersion: 0, data: { url: "https://api.example.com", apiKey: "sk-ant-api03-" + "a".repeat(40) } } });
  check("vault: an AI model key is refused", r.status === 400);
  r = await req("PUT", "/api/v1/cloud/vault/mcp:keyed", { token: A, body: { baseVersion: 0, data: { url: "https://api.example.com", apiKey: "ntn_" + "f".repeat(40) } } });
  check("vault: a connector's own key is accepted", r.status === 200);
  check("sign-in: no address → 400", (await start("mcp:none")).status === 400);
  check("sign-in: plain http refused", (await start("mcp:x", { url: "http://mcp.example.com/mcp" })).status === 400);
  check("sign-in: this machine / private network refused", (await start("mcp:x", { url: "https://10.0.0.5/mcp" })).status === 400 && (await start("mcp:x", { url: "https://localhost/mcp" })).status === 400);
  check("sign-in: signed out → 401", (await start("mcp:demo", {}, null)).status === 401);
  check("sign-in: from another website → 403", (await req("POST", "/api/v1/cloud/connectors/mcp:demo/oauth/start", { token: A, headers: { origin: "https://evil.example" }, body: {} })).status === 403);
  await req("PUT", "/api/v1/cloud/vault/mcp:demo", { token: A, body: { baseVersion: 0, data: { url: `${OAUTH}/mcp`, enabled: true, bots: ["b1"] } } });
  r = await start("mcp:demo");
  const au = r.body?.authUrl ? new URL(r.body.authUrl) : null;
  check("sign-in starts: the service's page, with PKCE, a state and the website's callback", r.status === 200 && !!au && au.searchParams.get("code_challenge_method") === "S256" && /^[0-9a-f]{64}$/.test(au.searchParams.get("state") ?? "") && au.searchParams.get("redirect_uri") === `${BASE}/api/v1/cloud/connectors/oauth/callback`, JSON.stringify(r.body).slice(0, 200));
  const flowRow = await db.query("SELECT state_hash, data::text AS t FROM cloud_oauth_flow WHERE user_id = 'cloudtest_a'");
  check("the flow keeps only a hash of the state, and its verifier sealed", flowRow.rowCount === 1 && flowRow.rows[0].state_hash !== au?.searchParams.get("state") && /"iv"/.test(flowRow.rows[0].t) && !flowRow.rows[0].t.includes("verifier"));
  // Back in the browser of the session that started it: finished at once.
  let ap = approve(r.body.authUrl);
  r = { loc: await cb({ code: ap.code, state: ap.state }) };
  check("same session: finished at once, back to the phone's Connectors page", r.loc.endsWith("/m/connectors?connected=mcp%3Ademo"), r.loc);
  r = await req("GET", "/api/v1/cloud/vault/mcp:demo", { token: A });
  check("tokens stored in the connector's vault entry, its settings kept, no verifier", r.body?.data?.oauth?.tokens?.refresh_token === "refresh-1" && r.body.data.oauth.clientInfo?.client_id?.startsWith("cid-") && r.body.data.enabled === true && r.body.data.bots?.[0] === "b1" && !("verifier" in r.body.data.oauth) && r.body.version === 2);
  // (The runner reads an account's sign-ins only while it holds a job of it.)
  await db.query("UPDATE cloud_device SET last_seen = now() - interval '5 minutes' WHERE user_id = 'cloudtest_a' AND kind = 'desktop'");
  const jV = (await req("POST", "/api/v1/cloud/jobs", { token: A, body: { chatId: "c1", kind: "message", payload: { text: "v" } } })).body.jobId;
  await db.query("UPDATE cloud_job SET created_at = now() - interval '10 seconds' WHERE id = $1", [jV]);
  await req("POST", "/api/v1/cloud/runner/claim", { runner: RUNNER, body: { runnerId: "r1" } });
  check("the runner can read the sign-in", (await req("GET", "/api/v1/cloud/runner/vault/cloudtest_a/mcp:demo", { runner: RUNNER })).body?.data?.oauth?.tokens?.refresh_token === "refresh-1");
  await req("POST", `/api/v1/cloud/runner/jobs/${jV}/done`, { runner: RUNNER, body: { runnerId: "r1", status: "done" } });
  check("a used state can't be replayed", (await cb({ code: ap.code, state: ap.state })).includes("error=expired"));

  // Back in ANOTHER browser (an iPhone home-screen app opens the sign-in in Safari: no session there).
  const A2 = crypto.randomBytes(24).toString("hex");
  await db.query(`INSERT INTO session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ('s_cloudtest_a2', $1, 'cloudtest_a', now() + interval '1 day', now(), now())`, [A2]);
  const cbFull = async (q, token, lang = "en") => {
    const x = await fetch(`${BASE}/api/v1/cloud/connectors/oauth/callback?${new URLSearchParams(q)}`, { redirect: "manual", headers: { "accept-language": lang, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: x.status, csp: x.headers.get("content-security-policy") ?? "", html: await x.text() };
  };
  const holdOf = (html) => /name="hold" value="([0-9a-f]{64})"/.exec(html)?.[1] ?? "";
  const confirm = (hold, origin = BASE) =>
    fetch(`${BASE}/api/v1/cloud/connectors/oauth/confirm`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin, "accept-language": "fr" }, body: `hold=${hold}` }).then(async (x) => ({ status: x.status, html: await x.text() }));
  const finish = (flowId, token = A) => req("POST", "/api/v1/cloud/connectors/oauth/finish", { token, body: { flowId } });
  const pending = async (token = A) => (await req("GET", "/api/v1/cloud/vault", { token })).body?.pending ?? [];
  let st = await start("mcp:demo");
  const flowId = st.body.flowId;
  ap = approve(st.body.authUrl);
  let h = await cbFull({ code: ap.code, state: ap.state }, null, "fr-FR,fr;q=0.9");
  const hold = holdOf(h.html);
  check("no session on the way back: a page in French, the account masked, one button, no script", h.status === 200 && h.html.includes('lang="fr"') && h.html.includes("a***@cloud.test") && h.html.includes("Oui, c&#39;est mon compte") && !h.html.includes("<script") && /default-src 'none'/.test(h.csp) && hold.length === 64);
  const heldRow = await db.query("SELECT held::text AS t, hold_hash FROM cloud_oauth_flow WHERE id = $1", [flowId]);
  check("the code is kept sealed and NOT exchanged yet", !!heldRow.rows[0]?.t && !heldRow.rows[0].t.includes(ap.code) && heldRow.rows[0].hold_hash !== hold && codes.has(ap.code));
  check("the same state can't come back twice", (await cb({ code: ap.code, state: ap.state }, null)).includes("error=expired"));
  check("GET /vault lists it, waiting for the account's confirmation, here=true", (await pending()).some((p) => p.flowId === flowId && p.status === "waiting_confirm" && p.here === true));
  check("not confirmed yet: finish waits (409)", (await finish(flowId)).status === 409);
  check("another account can't finish it (404)", (await finish(flowId, B)).status === 404);
  check("the same account in another session can't finish it (404), and sees here=false", (await finish(flowId, A2)).status === 404 && (await pending(A2)).some((p) => p.flowId === flowId && p.here === false));
  check("confirm from another website: refused", (await confirm(hold, "https://evil.example")).status === 403);
  check("a made-up confirm token: expired page", (await confirm("0".repeat(64))).status === 410);
  let cf = await confirm(hold);
  check("confirmed: 'go back to the oovi app' (French)", cf.status === 200 && cf.html.includes("Retournez dans l&#39;app oovi"), cf.html.slice(0, 200));
  check("GET /vault: waiting_finish", (await pending()).some((p) => p.flowId === flowId && p.status === "waiting_finish"));
  r = await finish(flowId);
  check("the starting session finishes it: the vault entry with the tokens", r.status === 200 && r.body.connectorId === "mcp:demo" && r.body.data?.oauth?.tokens?.refresh_token === "refresh-1" && r.body.data.bots?.[0] === "b1" && r.body.version === 3, JSON.stringify(r.body).slice(0, 200));
  check("finish twice: 404", (await finish(flowId)).status === 404);
  check("nothing left pending", !(await pending()).some((p) => p.flowId === flowId));
  check("a held flow's state can't be used after it was finished", (await cb({ code: ap.code, state: ap.state }, null)).includes("error=expired"));

  st = await start("mcp:demo");
  ap = approve(st.body.authUrl);
  h = await cbFull({ code: ap.code, state: ap.state }, B);
  check("back in a browser signed in to ANOTHER account: held, with a warning and the starter's masked account", h.status === 200 && h.html.includes("different oovi account") && h.html.includes("a***@cloud.test"));
  await confirm(holdOf(h.html));
  check("...the other account still can't finish it", (await finish(st.body.flowId, B)).status === 404);
  await db.query("UPDATE cloud_oauth_flow SET created_at = now() - interval '11 minutes' WHERE id = $1", [st.body.flowId]);
  check("held over 10 minutes: finish says expired (410), then it's gone (404)", (await finish(st.body.flowId)).status === 410 && (await finish(st.body.flowId)).status === 404);
  st = await start("mcp:demo");
  ap = approve(st.body.authUrl);
  h = await cbFull({ code: ap.code, state: ap.state }, null, "ar");
  check("the page in Arabic, right to left", h.html.includes('dir="rtl"') && h.html.includes("نعم، هذا حسابي"));
  await db.query("UPDATE cloud_oauth_flow SET created_at = now() - interval '11 minutes' WHERE id = $1", [st.body.flowId]);
  check("confirming after 10 minutes: expired page", (await confirm(holdOf(h.html))).status === 410);

  ap = approve((await start("mcp:demo")).body.authUrl);
  await db.query("UPDATE cloud_oauth_flow SET created_at = now() - interval '11 minutes' WHERE user_id = 'cloudtest_a'");
  check("after 10 minutes: expired (with the connector's id)", (await cb({ code: ap.code, state: ap.state })).includes("error=expired&id=mcp%3Ademo"));
  ap = approve((await start("mcp:demo")).body.authUrl);
  check("the person said no on the service's page → denied", (await cb({ error: "access_denied", state: ap.state })).includes("error=denied"));
  ap = approve((await start("mcp:demo")).body.authUrl);
  check("a wrong code → failed (the service refuses it)", (await cb({ code: "code-wrong", state: ap.state })).includes("error=failed"));
  check("a made-up state → expired", (await cb({ code: "x", state: "f".repeat(64) })).includes("error=expired"));
  r = await req("DELETE", "/api/v1/cloud/vault/mcp:demo", { token: A });
  check("disconnect from the phone removes the sign-in", r.status === 200 && (await req("GET", "/api/v1/cloud/vault/mcp:demo", { token: A })).status === 404);

  // ---- turning off, deleting the account ----
  r = await req("PUT", "/api/v1/cloud/status", { token: A, body: { enabled: false } });
  const left = await db.query(
    "SELECT (SELECT count(*) FROM cloud_chat WHERE user_id = $1) + (SELECT count(*) FROM cloud_vault WHERE user_id = $1) + (SELECT count(*) FROM cloud_job WHERE user_id = $1) + (SELECT count(*) FROM cloud_oauth_flow WHERE user_id = $1) AS n",
    ["cloudtest_a"],
  );
  check("turning off deletes chats, sign-ins, jobs and open sign-ins at once", r.status === 200 && r.body.enabled === false && r.body.chats === 0 && Number(left.rows[0].n) === 0);
  check("after turning off, the runner can't read them", (await req("GET", "/api/v1/cloud/runner/vault/cloudtest_a/mcp:gmail", { runner: RUNNER })).status === 403);
  await db.query(`DELETE FROM "user" WHERE id = 'cloudtest_b'`);
  const gone = await db.query("SELECT (SELECT count(*) FROM cloud_chat WHERE user_id = 'cloudtest_b') + (SELECT count(*) FROM cloud_sync WHERE user_id = 'cloudtest_b') AS n");
  check("deleting the account deletes its cloud rows", Number(gone.rows[0].n) === 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
