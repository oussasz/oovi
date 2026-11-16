// Setup sync between two computers of one account (lib/setup-sync.ts), with the built app and a stand-in
// oovi service that keeps the setup in memory, like the real one (versions, 409 on a stale save).
// PC A makes a bot, a group, a skill, a lesson and a routine. PC B signs in for the first time: it gets
// all of it, no first-run screens, no starter bots, no chats; its routine is paused. Then both edit and
// delete things and the changes cross both ways. Run: node tests/e2e/sync-scenario.cjs (after npm run build).
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CLOUD_PORT = 47931;
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && extra ? ` (${extra})` : ""}`);
};

// ---------- the stand-in oovi service ----------
let stored = { version: 0, items: null };
let puts = 0;
const USER = { id: "p1test", email: "tester@example.test", name: "Phase Tester", image: null };
const cloud = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const send = (code, j) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(j === undefined ? "" : JSON.stringify(j));
  };
  if (req.url === "/api/v1/setup" && req.method === "GET") return send(200, stored);
  if (req.url === "/api/v1/setup" && req.method === "PUT") {
    const b = JSON.parse(body);
    if (b.baseVersion !== stored.version) return send(409, { error: "changed" });
    puts++;
    if (process.env.SYNC_DEBUG && stored.items) for (const k of new Set([...Object.keys(stored.items), ...Object.keys(b.items)])) if (JSON.stringify(stored.items[k]) !== JSON.stringify(b.items[k])) console.log("  changed:", k, JSON.stringify(stored.items[k])?.slice(0, 300), "=>", JSON.stringify(b.items[k])?.slice(0, 300));
    stored = { version: stored.version + 1, items: b.items };
    return send(200, { version: stored.version });
  }
  if (req.url === "/api/v1/auth/sign-in") return send(200, { token: "fake-local-test-token", user: USER });
  return send(404, { error: "not here" });
});

function startPc(name, port, onboarded) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `oovi-sync-${name}-`));
  const proc = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: data, OOVI_TEST_ONBOARDED: onboarded ? "1" : "0", OOVI_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}`, OOVI_TELEGRAM_API: "http://127.0.0.1:1", PORT: String(port) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = null;
    try {
      j = JSON.parse(t);
    } catch {
      j = t;
    }
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${t.slice(0, 200)}`);
    return j;
  };
  return { name, data, proc, base, api, acc: path.join(data, "accounts", USER.id) };
}

async function ready(pc) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${pc.base}/api/account`)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${pc.name} did not start`);
}

// Runs one sync on that computer (the same function the timer and sign-in call).
const sync = (pc) => pc.api("POST", "/api/account/sync");

(async () => {
  await new Promise((r) => cloud.listen(CLOUD_PORT, "127.0.0.1", r));
  const A = startPc("a", 47932, true);
  const B = startPc("b", 47933, false);
  try {
    await Promise.all([ready(A), ready(B)]);

    // ---- PC A: the user's real setup ----
    const bots0 = await A.api("GET", "/api/bots");
    const writer = await A.api("POST", "/api/bots", { name: "Lina", role: "Writer", instructions: "Write clear posts.", face: { color: 3, shape: 1, hair: 2, eyes: 1, nose: 0, mouth: 1, cheeks: 1, top: 0, wear: 0 }, tools: { web: true, browser: false } });
    const linaId = writer.id;
    const g = await A.api("POST", "/api/chats", { kind: "group", name: "Marketing", memberIds: [linaId, bots0[0].id] });
    const groupId = g.id;
    // A message in the group (written as the app writes chats): it must stay on this computer.
    const gf = path.join(A.acc, "chats", `${groupId}.json`);
    const gj = JSON.parse(fs.readFileSync(gf, "utf8"));
    gj.entries.push({ kind: "user", id: "u1", text: "a message that must stay on PC A", createdAt: Date.now() });
    fs.writeFileSync(gf, JSON.stringify(gj));
    await A.api("POST", "/api/skills", { name: "Weekly report", description: "How to write the weekly report", body: "1. Collect numbers\n2. Write three lines" });
    await A.api("PUT", "/api/memory", { target: "user", text: "The user runs a bakery in Oran." });
    const routine = await A.api("POST", "/api/routines", { name: "Morning news", botId: linaId, prompt: "Send me the news", schedule: { kind: "daily", time: "08:00" }, enabled: true, timezone: "Africa/Algiers" });
    const r1 = await sync(A);
    check("PC A sends its setup to the account", r1.ok && stored.version === 1 && stored.items && stored.items[`bot:${linaId}`], JSON.stringify(r1));
    check("no chat messages in the account's copy", !JSON.stringify(stored.items).includes("must stay on PC A"));
    check("no API keys or secrets in the account's copy", !/apiKey|sk-ant|token/i.test(JSON.stringify(stored.items)));

    // ---- PC B: a new computer signs in ----
    const s = await B.api("POST", "/api/account", { action: "signin", email: USER.email, password: "x" });
    check("PC B skips the first-run screens", s.onboarded === true, JSON.stringify(s).slice(0, 200));
    const botsB = await B.api("GET", "/api/bots");
    const namesB = botsB.map((b) => b.name).sort();
    const namesA = (await A.api("GET", "/api/bots")).map((b) => b.name).sort();
    check("PC B has exactly PC A's bots (no extra starter bots)", JSON.stringify(namesB) === JSON.stringify(namesA), `${namesB} vs ${namesA}`);
    const chatsB = await B.api("GET", "/api/chats");
    const listB = chatsB;
    const groupB = listB.find((c) => c.id === groupId);
    check("PC B has the group, with its members", groupB && groupB.name === "Marketing");
    const full = await B.api("GET", `/api/chats/${groupId}`);
    check("the group's messages stayed on PC A", !JSON.stringify(full).includes("must stay on PC A"));
    const skillsB = await B.api("GET", "/api/skills");
    check("PC B has the skill", JSON.stringify(skillsB).includes("Weekly report"));
    const rB = JSON.stringify(await B.api("GET", "/api/routines"));
    const rA = JSON.stringify(await A.api("GET", "/api/routines"));
    check("PC B has the routine, paused (it runs on one computer only)", rB.includes("Morning news") && /"enabled":false/.test(rB) && /"enabled":true/.test(rA), `${routine && routine.id} ${rB.slice(0, 160)}`);
    const memB = await B.api("GET", "/api/memory");
    check("PC B knows what the bots learned about the user", JSON.stringify(memB).includes("bakery in Oran"));

    // ---- both computers change things ----
    await B.api("PUT", `/api/bots/${linaId}`, { ...botsB.find((b) => b.id === linaId), role: "Senior writer" });
    await sync(B);
    await sync(A);
    const linaA = (await A.api("GET", "/api/bots")).find((b) => b.id === linaId);
    check("an edit on PC B reaches PC A", linaA && linaA.role === "Senior writer", linaA && linaA.role);

    await A.api("DELETE", `/api/chats/${groupId}`);
    await sync(A);
    await sync(B);
    const afterDel = await B.api("GET", "/api/chats");
    check("a group deleted on PC A is deleted on PC B", !afterDel.some((c) => c.id === groupId));

    // two computers save at the same time: the second one merges (409) instead of overwriting
    const before = stored.version;
    await Promise.all([A.api("POST", "/api/skills", { name: "From A", description: "made on A", body: "a" }), B.api("POST", "/api/skills", { name: "From B", description: "made on B", body: "b" })]);
    await Promise.all([sync(A), sync(B)]);
    await sync(A);
    await sync(B);
    const both = JSON.stringify(stored.items);
    check("two computers saving together: nothing lost", both.includes("From A") && both.includes("From B") && stored.version > before);
    const sa = JSON.stringify(await A.api("GET", "/api/skills"));
    const sb = JSON.stringify(await B.api("GET", "/api/skills"));
    check("…and both computers end up with both skills", sa.includes("From B") && sb.includes("From A"));
    const p0 = puts;
    await sync(A);
    await sync(B);
    check("nothing changed: nothing is sent again", puts === p0);
  } catch (e) {
    check("scenario ran", false, e.message);
  } finally {
    A.proc.kill();
    B.proc.kill();
    cloud.close();
  }
  const ok = results.every((r) => r[1]);
  console.log(`${results.filter((r) => r[1]).length}/${results.length} checks passed`);
  process.exit(ok ? 0 : 1);
})();
