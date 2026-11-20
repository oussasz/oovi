// Cloud sync, desktop side (lib/cloud-sync.ts), against the built app and a stand-in oovi website that implements
// the cloud API of docs/CLOUD-BUILD.md in memory, with the exact shapes of part W (web/lib/cloud-types.ts on
// branch cloud-web) (versions, 409 on a stale save, 413 over the limit, tombstones,
// jobs with a claim) and theOovi model. Nothing leaves this machine.
// Checked: sync is off until the user says yes; the old chats are uploaded; a local-only bot's chats (and a group
// with it) never leave; model keys, search keys, website passwords and the session never appear in anything sent;
// connectors go to the vault; a change made on another device is merged in; two devices saving at once merge
// (409); a message sent from the phone is run by this computer and its answer reaches the account; a chat
// deleted here or there is deleted on the other side; a full account keeps new chats here; turning sync off
// deletes the account's copy and keeps this computer's.
// Run: node tests/e2e/cloud-sync-scenario.cjs (after npm run build).
const http = require("node:http");
const { asModel } = require("./all-tools.cjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");
const rules = require("./model-rules.cjs");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "oovi-cloud-sync-"));
const PORT = 3341;
const CLOUD_PORT = 3397;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "fake-local-test-token";
const OPENAI_KEY = "sk-test-NEVER-LEAVES-1234567890abcdef";
const BRAVE_KEY = "BSA-test-NEVER-LEAVES-0987654321";
const SITE_PASSWORD = "p4ss-NEVER-LEAVES-site";
const CONNECTOR_SECRET = "conn-secret-TRAVELS-TO-VAULT-42";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
};

// ---------- the stand-in website ----------
let lastTools = [];
const cloud = { enabled: false, limit: 100 * 1024 * 1024, maxChat: 4 * 1024 * 1024, deviceHeaders: new Set(), chats: new Map(), vault: new Map(), jobs: [], devices: new Map(), lastSync: null };
const sentBodies = []; // every request body the app sent to the website
// What sync sent (the model's own requests carry the chat the user is having with theOovi: not sync).
const synced = () => sentBodies.filter((x) => x.path.startsWith("/api/v1/cloud/") || x.path === "/api/v1/setup");
const counts = { put409: 0, put413: 0, statusOff: 0, chatGets: 0, badBodies: 0 };
const err = (code, error, extra = {}) => ({ error, code, ...extra });
const nowIso = () => new Date().toISOString();
const bytes = () => [...cloud.chats.values()].filter((c) => !c.deleted).reduce((n, c) => n + c.bytes, 0);
const bump = () => (cloud.lastSync = nowIso());
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const aiStatus = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const lastUserText = (body) => {
  const m = [...(body.messages || [])].reverse().find((x) => x.role === "user" && (typeof x.content === "string" || (x.content || []).some((b) => b.type === "text")));
  if (!m) return "";
  return typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
};
// The phone's message (a job) is still running when we look: its answer comes after a short pause.
const slowFor = /PHONE/;

const setupStore = { version: 0, items: null };
/** The phone (or another device) adds work: what POST /jobs would store. */
const queueJob = (chatId, kind, payload) => {
  const job = { id: `job-${cloud.jobs.length + 1}`, chatId, kind, payload, status: "queued", claimedBy: null, beats: 0 };
  cloud.jobs.push(job);
  return job;
};
/** Another device saved this chat (what PUT /chats/<id> from the phone or a second computer would do). */
const otherDeviceSaves = (id, change) => {
  const cur = cloud.chats.get(id);
  const chat = change(JSON.parse(JSON.stringify(cur.chat)));
  chat.updatedAt = Date.now();
  cloud.chats.set(id, { ...cur, version: cur.version + 1, chat, updatedAt: nowIso(), bytes: JSON.stringify(chat).length });
};

const site = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const send = (code, j) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(j === undefined ? "" : JSON.stringify(j));
  };
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  if (raw) sentBodies.push({ path: p, body: raw });
  if (p === "/api/v1/ai/status") return send(200, aiStatus);
  if (p === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Phase Tester", image: null } });
  if (p === "/api/v1/catalog") return send(200, { items: [] });
  if (p === "/api/v1/setup") {
    // The account's setup (bots, groups…), as the phone can change it: kept here so a bot added "on the phone" exists.
    if (req.method === "GET") return send(200, { version: setupStore.version, items: setupStore.items });
    const b = JSON.parse(raw || "{}");
    if (b.baseVersion !== setupStore.version) return send(409, { error: "changed", code: "conflict" });
    setupStore.items = b.items;
    setupStore.version += 1;
    return send(200, { version: setupStore.version });
  }
  if (p === "/api/v1/ai/messages" && req.method === "POST") {
    const b = asModel(JSON.parse(raw));
    const refused = rules.refusal(b);
    if (refused) return send(400, { error: refused });
    if (rules.isDoneCheck(b)) return send(200, rules.doneReply(b));
    lastTools = (b.tools || []).map((t) => t.name);
    const text = lastUserText(b);
    if (slowFor.test(text)) await sleep(2500);
    const said = (text.match(/(HELLO-\w+|PHONE-\w+|SCOUT-\w+|LOCAL-\w+|TEAM-\w+|GONE-\w+|BIG-\w+)/g) || []).at(-1) || "ok";
    return send(200, { id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content: [{ type: "text", text: `REPLY ${said}` }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 }, oovi: live() });
  }
  if (!p.startsWith("/api/v1/cloud/")) return send(204);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "signed out" });
  const dev = req.headers["x-oovi-device"];
  if (dev) cloud.deviceHeaders.add(dev);
  const b = raw ? asModel(JSON.parse(raw)) : {};
  const r = p.slice("/api/v1/cloud".length);
  let m;
  if (r === "/status" && req.method === "GET") {
    const devices = [...cloud.devices.values()].map((d) => ({ ...d, online: Date.now() - Date.parse(d.lastSeen) < 60_000 }));
    return send(200, { enabled: cloud.enabled, bytes: bytes(), limit: cloud.limit, chats: [...cloud.chats.values()].filter((c) => !c.deleted).length, lastSync: cloud.lastSync, devices });
  }
  if (r === "/status" && req.method === "PUT") {
    cloud.enabled = b.enabled === true;
    if (!cloud.enabled) {
      counts.statusOff++;
      cloud.chats.clear();
      cloud.vault.clear();
      cloud.jobs.length = 0;
    }
    return send(200, { enabled: cloud.enabled });
  }
  if (!cloud.enabled) return send(403, err("sync_off", "Cloud sync is off for this account."));
  if (r === "/chats" && req.method === "GET") {
    const since = u.searchParams.get("since");
    const list = [...cloud.chats.entries()].filter(([, c]) => !since || c.updatedAt > since).map(([chatId, c]) => ({ chatId, version: c.version, updatedAt: c.updatedAt, deleted: !!c.deleted, bytes: c.bytes }));
    return send(200, { chats: list, now: nowIso() });
  }
  if ((m = r.match(/^\/chats\/([\w-]+)$/))) {
    const id = m[1];
    const cur = cloud.chats.get(id);
    if (req.method === "GET") {
      counts.chatGets++;
      if (!cur) return send(404, err("not_found", "This chat isn't in the cloud."));
      return send(200, { chatId: id, version: cur.version, deleted: !!cur.deleted, chat: cur.deleted ? null : cur.chat });
    }
    if (req.method === "PUT") {
      const curVersion = cur ? cur.version : 0;
      if (b.baseVersion !== curVersion && !(cur?.deleted && b.baseVersion === 0)) {
        counts.put409++;
        return send(409, err("conflict", "Changed on another device.", { version: curVersion, deleted: !!cur?.deleted, chat: cur && !cur.deleted ? cur.chat : null }));
      }
      const size = JSON.stringify(b.chat).length;
      if (size > cloud.maxChat) {
        counts.put413++;
        return send(413, err("too_big", "This chat is too big to sync.", { bytes: 0, limit: cloud.maxChat }));
      }
      if (bytes() - (cur && !cur.deleted ? cur.bytes : 0) + size > cloud.limit) {
        counts.put413++;
        return send(413, err("over_limit", "Your cloud space is full.", { bytes: bytes(), limit: cloud.limit }));
      }
      cloud.chats.set(id, { version: curVersion + 1, chat: b.chat, updatedAt: nowIso(), bytes: size, deleted: false });
      bump();
      return send(200, { version: curVersion + 1 });
    }
    if (req.method === "DELETE") {
      if (!cur) return send(404, err("not_found", "This chat isn't in the cloud."));
      cloud.chats.set(id, { ...cur, version: cur.version + 1, deleted: true, chat: null, updatedAt: nowIso(), bytes: 0 });
      return send(200, { version: cur.version + 1 });
    }
  }
  // cloud.staleList: the list still shows these versions (as if this computer's regular sync hadn't run yet).
  if (r === "/vault" && req.method === "GET") return send(200, { items: [...cloud.vault.entries()].map(([connectorId, v]) => ({ connectorId, version: cloud.staleList?.[connectorId] ?? v.version, updatedAt: nowIso() })), pending: [] });
  if ((m = r.match(/^\/vault\/([\w-]+)$/))) {
    const cur = cloud.vault.get(m[1]);
    if (req.method === "GET") return cur ? send(200, { connectorId: m[1], version: cur.version, data: cur.data }) : send(404, err("not_found", "Not in the cloud."));
    if (req.method === "PUT") {
      if (!b.data || typeof b.data !== "object") {
        counts.badBodies++;
        return send(400, err("bad_request", "data is missing."));
      }
      // Like W: an AI model key is refused.
      if (/"(sk-ant-|sk-proj-|sk-or-v1-|gsk_|xai-)[A-Za-z0-9_-]{16,}"/.test(JSON.stringify(b.data))) return send(400, err("bad_request", "AI model keys stay on your computer."));
      if ((cur?.version ?? 0) !== b.baseVersion) return send(409, err("conflict", "Changed on another device.", { version: cur?.version ?? 0, data: cur?.data ?? null }));
      cloud.vault.set(m[1], { version: (cur?.version ?? 0) + 1, data: b.data });
      return send(200, { version: (cur?.version ?? 0) + 1 });
    }
    if (req.method === "DELETE") {
      cloud.vault.delete(m[1]);
      return send(200, { ok: true });
    }
  }
  if (r === "/jobs/claim" && req.method === "POST") {
    if (b.kind !== "desktop" || typeof b.deviceId !== "string" || !b.deviceId) {
      counts.badBodies++;
      return send(400, err("bad_request", "deviceId is missing or invalid."));
    }
    cloud.devices.set(b.deviceId, { deviceId: b.deviceId, kind: b.kind, lastSeen: nowIso() });
    const job = cloud.jobs.find((j) => j.status === "queued");
    if (!job) return send(200, { job: null });
    job.status = "claimed";
    job.claimedBy = `${b.kind}:${b.deviceId}`;
    job.headerDevice = dev;
    return send(200, { job: { jobId: job.id, chatId: job.chatId, kind: job.kind, payload: job.payload, was: "queued", createdAt: nowIso(), leaseUntil: new Date(Date.now() + 120_000).toISOString() } });
  }
  if ((m = r.match(/^\/jobs\/([\w-]+)\/(heartbeat|done)$/))) {
    const job = cloud.jobs.find((j) => j.id === m[1]);
    if (!job) return send(404, err("not_found", "No such job."));
    if (typeof b.deviceId !== "string" || job.claimedBy !== `desktop:${b.deviceId}`) {
      counts.badBodies++;
      return send(409, err("conflict", "This lease isn't yours."));
    }
    if (m[2] === "heartbeat") job.beats++;
    else {
      job.status = b.status;
      job.error = b.error;
    }
    return send(200, { ok: true });
  }
  return send(404, { error: `no route ${req.method} ${r}` });
});

// ---------- the app ----------
let server;
const api = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { status: r.status, j };
};
const idle = async (chat) => {
  for (let i = 0; i < 400; i++) {
    const c = (await api("GET", `/api/chats/${chat}`)).j;
    if (c && !c.running) return c;
    await sleep(250);
  }
  throw new Error("the run didn't end");
};
const say = async (chat, text) => {
  const r = await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  await r.text();
  return idle(chat);
};
const waitFor = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {
      /* not yet */
    }
    await sleep(300);
  }
  console.log(`  (gave up waiting for: ${what})`);
  return false;
};
const syncNow = () => api("POST", "/api/cloud", { action: "sync" });
const onServer = (id) => {
  const c = cloud.chats.get(id);
  return c && !c.deleted ? c.chat : null;
};
const texts = (chat) => (chat?.entries || []).map((e) => e.text || "");

(async () => {
  await new Promise((r) => site.listen(CLOUD_PORT, "127.0.0.1", r));
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TEST_CLOUD_ASK: "1", OOVI_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}`, OOVI_TELEGRAM_API: "http://127.0.0.1:1", PORT: String(PORT) },
    stdio: process.env.DEBUG ? "inherit" : "ignore",
  });
  try {
    await waitFor("the app", async () => (await fetch(`${BASE}/api/account`)).ok, 60_000);

    // ---- before: off, and the question waits for an answer ----
    let st = (await api("GET", "/api/cloud")).j;
    check("sync is off until the user says yes, and the question is asked once", st.enabled === false && st.asked === false && st.signedIn === true, JSON.stringify(st));

    // ---- this computer's setup: keys, a password, a connector, a local-only bot, old chats ----
    await api("POST", "/api/settings", { active: "oovi", providers: { openai: { apiKey: OPENAI_KEY } }, search: { provider: "brave", braveKey: BRAVE_KEY } });
    await api("POST", "/api/logins", { site: "example.com", username: "me@example.com", password: SITE_PASSWORD });
    const conn = await api("POST", "/api/mcp", { name: "Notes vault", transport: "http", url: "http://127.0.0.1:1/mcp", headers: { Authorization: `Bearer ${CONNECTOR_SECRET}` } });
    const bots = (await api("GET", "/api/bots")).j;
    const oovi = bots.find((b) => b.name === "Oovi");
    const scout = bots.find((b) => b.name === "Scout");
    const nova = bots.find((b) => b.name === "Nova");
    const { id: _n, createdAt: _c, ...novaInput } = nova;
    const novaSaved = await api("PUT", `/api/bots/${nova.id}`, { ...novaInput, local: true });
    check("a bot can be set to “On this computer only”", novaSaved.status === 200 && novaSaved.j.local === true, JSON.stringify(novaSaved.j).slice(0, 200));
    const studio = (await api("GET", "/api/chats")).j.find((c) => c.kind === "group" && c.name === "Studio");
    const dmO = `dm-${oovi.id}`;
    const dmS = `dm-${scout.id}`;
    const dmN = `dm-${nova.id}`;
    const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), "oovi-cloud-my-project-"));
    const ws = await api("PUT", `/api/chats/${dmO}`, { workspace: { path: PROJECT, autoEdit: false } });
    await say(dmO, `HELLO-one my key is ${OPENAI_KEY}`);
    await say(dmS, "SCOUT-one find me a bakery");
    await say(dmN, "LOCAL-secret talk that never leaves");
    await say(studio.id, "LOCAL-group message for the whole team");
    check("before the answer nothing went to the cloud", !sentBodies.some((x) => x.path.startsWith("/api/v1/cloud/")), sentBodies.map((x) => x.path).join(","));

    // ---- the user says "Turn on" ----
    const on = await api("POST", "/api/cloud", { action: "answer", choice: "cloud" });
    check("turning sync on tells the account", on.status === 200 && on.j.ok === true && cloud.enabled === true, JSON.stringify(on.j).slice(0, 300));
    await waitFor("old chats uploaded", () => onServer(dmO) && onServer(dmS) && cloud.vault.size > 0);
    check("the old chats were uploaded (with their replies)", texts(onServer(dmO)).some((t) => t === "REPLY HELLO-one") && texts(onServer(dmS)).some((t) => /SCOUT-one/.test(t)), JSON.stringify(texts(onServer(dmO))));
    check("a local-only bot's chat never left this computer", !onServer(dmN) && !synced().some((x) => /LOCAL-secret/.test(x.body)));
    check("a group with a local-only bot stays on this computer", !onServer(studio.id) && !synced().some((x) => /LOCAL-group/.test(x.body)));
    const everything = synced().map((x) => x.body).join("\n");
    check("model keys, search keys, website passwords and the session never leave", ![OPENAI_KEY, BRAVE_KEY, SITE_PASSWORD, TOKEN].some((s) => everything.includes(s)));
    check("a key typed into a chat is hidden in the uploaded copy", texts(onServer(dmO)).some((t) => /my key is \[hidden\]/.test(t)), JSON.stringify(texts(onServer(dmO))));
    const v = cloud.vault.get(conn.j.id);
    check("connectors go to the account's vault, with their sign-in", !!v && v.data.url === "http://127.0.0.1:1/mcp" && v.data.headers?.Authorization === `Bearer ${CONNECTOR_SECRET}`, JSON.stringify(v));
    st = (await api("GET", "/api/cloud?fresh=1")).j;
    check("Settings shows the status: on, synced chats, space, no problem", st.enabled && st.asked && st.chats.synced >= 2 && st.chats.localOnly >= 2 && st.remote && st.remote.bytes > 0 && st.lastSync && !st.problem, JSON.stringify(st).slice(0, 400));
    // The app's copy of the chat must still be the same after the upload (nothing rewritten).
    const localO = (await api("GET", `/api/chats/${dmO}`)).j;
    check("this computer keeps its own copy, untouched (the key it typed stays here)", texts(localO).some((t) => t.includes(OPENAI_KEY)));

    // ---- a change made on another device is merged in ----
    const beforePull = (await api("GET", `/api/chats/${dmO}`)).j;
    otherDeviceSaves(dmO, (c) => {
      c.entries.push({ id: "other-pc-1", kind: "user", text: "HELLO-from another computer", at: Date.now() - 60_000 });
      // A copy that tries to give itself rights on this computer.
      c.workspace = { path: "/", autoEdit: true };
      c.allow = ["tool:mcp_notes_vault_delete"];
      return c;
    });
    // Its clock is behind: the chat must still look changed here, so an open chat window refreshes.
    cloud.chats.get(dmO).chat.updatedAt = beforePull.updatedAt - 60_000;
    await syncNow();
    const afterPull = (await api("GET", `/api/chats/${dmO}`)).j;
    check("a message added on another device shows here (an open chat window sees the change)", texts(afterPull).includes("HELLO-from another computer") && afterPull.updatedAt > beforePull.updatedAt, JSON.stringify(texts(afterPull)));
    check("another device can't give itself rights on this computer (project folder, allowed actions)", ws.status === 200 && afterPull.workspace?.path === ws.j.workspace?.path && afterPull.workspace?.autoEdit === false && !afterPull.allow, JSON.stringify({ w: afterPull.workspace, a: afterPull.allow }));
    check("this computer's own folder and allowed actions are never uploaded", !synced().some((x) => x.path.startsWith("/api/v1/cloud/chats/") && (/"workspace"|"allow"/.test(x.body) || x.body.includes("oovi-cloud-my-project"))));

    // ---- two devices save at once: merged, nothing lost ----
    otherDeviceSaves(dmS, (c) => {
      c.entries.push({ id: "other-pc-2", kind: "user", text: "SCOUT-from the laptop", at: Date.now() });
      return c;
    });
    const before409 = counts.put409;
    await say(dmS, "SCOUT-two from this computer");
    await waitFor("both edits on both sides", async () => {
      const here = texts((await api("GET", `/api/chats/${dmS}`)).j);
      const there = texts(onServer(dmS));
      return ["SCOUT-from the laptop", "SCOUT-two from this computer", "REPLY SCOUT-two"].every((t) => here.includes(t) && there.includes(t));
    });
    const hereS = texts((await api("GET", `/api/chats/${dmS}`)).j);
    const thereS = texts(onServer(dmS));
    check("two devices saving the same chat: both changes kept on both sides", ["SCOUT-from the laptop", "SCOUT-two from this computer", "REPLY SCOUT-two"].every((t) => hereS.includes(t) && thereS.includes(t)), `here ${JSON.stringify(hereS)} there ${JSON.stringify(thereS)} (409s: ${counts.put409 - before409})`);

    // ---- the phone sends a message: this computer runs it ----
    const job = queueJob(dmO, "message", { text: "PHONE-one what's new?" });
    const sawRunning = await waitFor("the phone's message running here, visible on the account", () => texts(onServer(dmO)).includes("PHONE-one what's new?") && job.status === "claimed", 20_000);
    await waitFor("the phone's job done", () => job.status === "done", 30_000);
    const phoneChat = onServer(dmO);
    const i = texts(phoneChat).indexOf("PHONE-one what's new?");
    check("a message from the phone is run by this computer", job.status === "done" && job.claimedBy?.startsWith("desktop:") && i >= 0 && texts(phoneChat).slice(i + 1).includes("REPLY PHONE-one"), `${job.status} ${job.claimedBy} ${JSON.stringify(texts(phoneChat).slice(-3))}`);
    check("the phone sees it live (the chat is pushed while the bots work)", sawRunning);
    const localAfterJob = (await api("GET", `/api/chats/${dmO}`)).j;
    check("…and the answer is in the chat on this computer too", texts(localAfterJob).includes("REPLY PHONE-one"));
    const devs = (await api("GET", "/api/cloud?fresh=1")).j.remote?.devices || [];
    check("this computer is listed as an online device", devs.some((d) => d.kind === "desktop" && d.online && d.thisOne), JSON.stringify(devs));
    check("every request says which device it is, as W reads it (desktop:<id>), and job calls carry the device id", [...cloud.deviceHeaders].length === 1 && /^desktop:[a-f0-9]{16,}$/.test([...cloud.deviceHeaders][0]) && counts.badBodies === 0, JSON.stringify([...cloud.deviceHeaders]) + ` bad=${counts.badBodies}`);
    // A bot added on the phone a moment ago, and a message to it right away: this computer fetches the account's
    // setup first, then runs it (it must not end as "not on this computer").
    {
      const tpl = (await api("GET", "/api/bots")).j[0];
      const nb = { ...tpl, id: "a1b2c3d4e5f6", name: "Phonebot" };
      setupStore.items = { ...(setupStore.items || {}), [`bot:${nb.id}`]: nb };
      setupStore.version += 1;
      const nj = queueJob(`dm-${nb.id}`, "message", { text: "PHONE-newbot hello" });
      await waitFor("the new bot's job done", () => nj.status === "done" || nj.status === "failed", 40_000);
      check("a bot made on the phone moments ago: its first message is run here, not refused", nj.status === "done" && texts(onServer(`dm-${nb.id}`)).includes("REPLY PHONE-newbot"), `${nj.status} ${nj.error || ""}`);
    }
    // Stop from the phone; a bad job is refused, not run.
    const stopJob = queueJob(dmO, "stop", {});
    const badJob = queueJob(dmO, "shell", { text: "rm -rf /" });
    await waitFor("stop and bad jobs handled", () => stopJob.status === "done" && badJob.status === "failed", 20_000);
    check("Stop from the phone is handled; an unknown job is refused", stopJob.status === "done" && badJob.status === "failed", `${stopJob.status} ${badJob.status}`);
    // A job for a local-only bot's chat is never run.
    const localJob = queueJob(dmN, "message", { text: "LOCAL-should not run" });
    await waitFor("local job refused", () => localJob.status === "failed", 20_000);
    const localN = (await api("GET", `/api/chats/${dmN}`)).j;
    check("a job for a local-only chat is refused", localJob.status === "failed" && !texts(localN).includes("LOCAL-should not run"), localJob.status);

    // ---- moving a bot to "this computer only" takes its chat off the account ----
    const { id: _s, createdAt: _sc, ...scoutInput } = (await api("GET", `/api/bots/${scout.id}`)).j;
    await api("PUT", `/api/bots/${scout.id}`, { ...scoutInput, local: true });
    await waitFor("Scout's chat gone right away", () => cloud.chats.get(dmS)?.deleted === true, 10_000);
    await say(dmS, "SCOUT-three after going local");
    await waitFor("Scout's chat gone from the account", () => cloud.chats.get(dmS)?.deleted === true);
    check("a bot set to local: its chat is removed from the account", cloud.chats.get(dmS)?.deleted === true && !synced().some((x) => /SCOUT-three/.test(x.body)));

    // ---- deletions travel both ways ----
    const team = (await api("POST", "/api/chats", { kind: "group", name: "Team", memberIds: [oovi.id] })).j;
    await say(team.id, "TEAM-hello");
    await waitFor("Team uploaded", () => texts(onServer(team.id)).includes("REPLY TEAM-hello"));
    await api("DELETE", `/api/chats/${team.id}`);
    await waitFor("Team deleted on the account", () => cloud.chats.get(team.id)?.deleted === true);
    check("a chat deleted here is deleted on the account (a tombstone for the other devices)", cloud.chats.get(team.id)?.deleted === true);
    const gone = (await api("POST", "/api/chats", { kind: "group", name: "Gone", memberIds: [oovi.id] })).j;
    await say(gone.id, "GONE-hello");
    await waitFor("Gone uploaded", () => texts(onServer(gone.id)).includes("REPLY GONE-hello"));
    const g = cloud.chats.get(gone.id);
    cloud.chats.set(gone.id, { ...g, version: g.version + 1, deleted: true, chat: null, updatedAt: nowIso(), bytes: 0 });
    await syncNow();
    const stillThere = await api("GET", `/api/chats/${gone.id}`);
    check("a chat deleted on another device is deleted here", stillThere.status === 404, String(stillThere.status));

    // ---- the account is full: new chats stay here, Settings says so ----
    cloud.limit = bytes() + 10;
    const big = (await api("POST", "/api/chats", { kind: "group", name: "Big", memberIds: [oovi.id] })).j;
    await say(big.id, "BIG-hello");
    await syncNow();
    st = (await api("GET", "/api/cloud")).j;
    check("over the limit: the new chat stays here and Settings says the space is full", !onServer(big.id) && counts.put413 > 0 && st.problem === "tooBig" && st.tooBig === true, JSON.stringify({ problem: st.problem, tooBig: st.tooBig, n413: counts.put413 }));
    cloud.limit = 100 * 1024 * 1024;

    // ---- one chat over the per-chat size: it stays here, the others go on ----
    cloud.maxChat = 2000;
    const long = (await api("POST", "/api/chats", { kind: "group", name: "Long", memberIds: [oovi.id] })).j;
    await say(long.id, `HELLO-long ${"x".repeat(3000)}`);
    await syncNow();
    st = (await api("GET", "/api/cloud")).j;
    check("one chat too long to sync: it stays here and Settings says so (the account isn't called full)", !onServer(long.id) && st.problem === "chatTooBig" && !st.tooBig, JSON.stringify({ p: st.problem, t: st.tooBig }));
    cloud.maxChat = 4 * 1024 * 1024;

    // ---- connectors managed on the phone: added and signed in, switched off, bots chosen, removed ----
    const quill = bots.find((b) => b.name === "Quill");
    cloud.vault.set("phone-notion", { version: 1, data: { name: "Phone Notion", transport: "http", url: "http://127.0.0.1:1/phone-mcp", auth: "oauth", oauth: { tokens: { access_token: "phone-token-123", token_type: "Bearer" }, signedInAt: Date.now() }, enabled: true, trusted: false, bots: [oovi.id] } });
    await syncNow();
    let mine = (await api("GET", "/api/mcp")).j.find((x) => x.id === "phone-notion");
    let botsNow = (await api("GET", "/api/bots")).j;
    check("a connector added and signed in on the phone appears here, ready, for the bots chosen there", mine && mine.signedIn === true && mine.enabled === true && botsNow.find((b) => b.id === oovi.id).tools.mcp.includes("phone-notion"), JSON.stringify(mine));
    const pv = cloud.vault.get("phone-notion");
    cloud.vault.set("phone-notion", { version: pv.version + 1, data: { ...pv.data, enabled: false, bots: [quill.id] } });
    await syncNow();
    mine = (await api("GET", "/api/mcp")).j.find((x) => x.id === "phone-notion");
    botsNow = (await api("GET", "/api/bots")).j;
    check("switched off and given to another bot on the phone: the same here", mine && mine.enabled === false && botsNow.find((b) => b.id === quill.id).tools.mcp.includes("phone-notion") && !botsNow.find((b) => b.id === oovi.id).tools.mcp.includes("phone-notion"), JSON.stringify({ mine, q: botsNow.find((b) => b.id === quill.id).tools }));
    check("the phone's sign-in is stored here encrypted (never as plain text on disk)", !fs.readFileSync(path.join(DATA, "accounts", "p1test", "mcp.json"), "utf8").includes("phone-token-123"));
    cloud.vault.delete("phone-notion");
    await syncNow();
    mine = (await api("GET", "/api/mcp")).j.find((x) => x.id === "phone-notion");
    botsNow = (await api("GET", "/api/bots")).j;
    st = (await api("GET", "/api/cloud")).j;
    check("removed on the phone: removed here, no question, and Settings > Sync says so", !mine && !botsNow.some((b) => (b.tools.mcp || []).includes("phone-notion")) && st.removedConnectors.includes("Phone Notion"), JSON.stringify(st.removedConnectors));
    check("…while the connector made here stays", (await api("GET", "/api/mcp")).j.some((x) => x.id === conn.j.id) && cloud.vault.has(conn.j.id));

    // ---- a sign-in renewed elsewhere while this computer was off (owner, 2026-11-19: Zapier "isn't enabled" after the
    // cloud server renewed it): this computer takes the account's newer sign-in before connecting, instead of failing ----
    const zapSeen = [];
    const signin = await new Promise((resolve) => {
      const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
      const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
      const srv = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", async () => {
          zapSeen.push(`${req.method} ${req.url} ${String(req.headers.authorization || "-").slice(0, 30)}`);
          if (req.headers.authorization !== "Bearer renewed-token-2") {
            res.writeHead(401, { "content-type": "application/json" });
            return res.end('{"error":"invalid_token"}');
          }
          const server = new McpServer({ name: "zap", version: "1.0.0" });
          server.registerTool("execute_zapier_read_action", { description: "Run a read action" }, async () => ({ content: [{ type: "text", text: "ok" }] }));
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          res.on("close", () => {
            transport.close();
            server.close();
          });
          await server.connect(transport);
          await transport.handleRequest(req, res, raw ? asModel(JSON.parse(raw)) : undefined);
        });
      });
      srv.listen(3391, "127.0.0.1", () => resolve(srv));
    });
    const zapData = (token, at) => ({ name: "Cloud Zap", transport: "http", url: "http://127.0.0.1:3391/mcp", auth: "oauth", oauth: { tokens: { access_token: token, token_type: "Bearer" }, signedInAt: at }, enabled: true, trusted: false, bots: [oovi.id] });
    cloud.vault.set("cloud-zap", { version: 1, data: zapData("old-token-1", Date.now() - 60_000) });
    await syncNow();
    // Renewed on the cloud server; this computer hasn't synced since.
    cloud.vault.set("cloud-zap", { version: 2, data: zapData("renewed-token-2", Date.now()) });
    cloud.staleList = { "cloud-zap": 1 };
    lastTools = [];
    const zapHere = (await api("GET", "/api/mcp")).j.find((x) => x.id === "cloud-zap");
    const ooviMcp = (await api("GET", "/api/bots")).j.find((b) => b.id === oovi.id).tools.mcp;
    await say(dmO, "HELLO-zap check my mail");
    const zapAfter = (await api("GET", "/api/mcp")).j.find((x) => x.id === "cloud-zap");
    check("a sign-in renewed elsewhere: taken from the account before connecting, the connector's tools are there", lastTools.some((t) => /^mcp_cloud_zap_execute_zapier_read_action$/.test(t)), JSON.stringify({ after: zapAfter && { at: zapAfter.signedInAt, status: zapAfter.status, error: zapAfter.error }, before: zapHere && zapHere.signedInAt, tools: lastTools.filter((t) => t.startsWith("mcp_")), zapSeen: zapSeen.slice(0, 12) }));
    signin.close();
    cloud.staleList = null;
    cloud.vault.delete("cloud-zap");
    await syncNow();

    // ---- turned off on another device (the account answers sync_off): stops here, keeps the chats ----
    cloud.enabled = false;
    cloud.chats.clear();
    cloud.vault.clear();
    await syncNow();
    await waitFor("off here too", async () => (await api("GET", "/api/cloud")).j.enabled === false, 20_000);
    st = (await api("GET", "/api/cloud")).j;
    const keptO = (await api("GET", `/api/chats/${dmO}`)).j;
    check("turned off on another device: off here too, Settings says so, chats and connectors kept", st.enabled === false && st.offElsewhere === true && texts(keptO).includes("REPLY PHONE-one") && (await api("GET", "/api/mcp")).j.some((x) => x.id === conn.j.id), JSON.stringify({ e: st.enabled, o: st.offElsewhere }));
    const again = await api("POST", "/api/cloud", { action: "on" });
    await waitFor("uploaded again", () => !!onServer(dmO) && cloud.vault.has(conn.j.id));
    check("turned on again: everything is uploaded again", again.j.ok === true && texts(onServer(dmO)).includes("REPLY PHONE-one") && cloud.vault.has(conn.j.id));

    // ---- turning it off deletes the account's copy, keeps this computer's ----
    const off = await api("POST", "/api/cloud", { action: "off" });
    check("turning sync off deletes the account's copy at once", off.j.ok === true && counts.statusOff === 1 && cloud.chats.size === 0 && cloud.vault.size === 0 && off.j.status.enabled === false, JSON.stringify(off.j).slice(0, 200));
    const keep = (await api("GET", `/api/chats/${dmO}`)).j;
    check("…and this computer keeps all its chats", texts(keep).includes("REPLY PHONE-one") && texts(keep).includes("HELLO-from another computer"));
    const n = sentBodies.length;
    await say(dmO, "HELLO-after off");
    queueJob(dmO, "message", { text: "PHONE-after off" });
    await sleep(5000);
    check("after turning off: nothing more is sent and no phone work is taken", !sentBodies.slice(n).some((x) => x.path.startsWith("/api/v1/cloud/")), sentBodies.slice(n).map((x) => x.path).join(","));
  } catch (e) {
    check("scenario ran to the end", false, e.stack || String(e));
  } finally {
    server?.kill();
    site.close();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(`(stand-in website: ${counts.put409} conflicts merged, ${counts.put413} refused as too big, ${counts.chatGets} chat reads)`);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
