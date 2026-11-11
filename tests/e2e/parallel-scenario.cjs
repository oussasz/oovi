// Teammates working at the same time, end to end against the built oovi server with a scripted, slow
// stand-in for theOovi's model (nothing leaves this machine). Checked here:
//   A) work the leader hands to three teammates runs at the same time (their model calls overlap),
//   B) never more calls at once than the server allows (2 here): the rest wait in line, none fails as "busy",
//   C) while they work, a teammate doesn't see the others' replies; the leader then sees all of them, once,
//   D) two teammates needing the user's OK at the same time: one card at a time, nobody skipped,
//      and the leader's turn comes only after both were answered,
//   E) one teammate's failure doesn't lose the others' work: the leader is told which part failed,
//   F) Stop stops everyone, and nothing is left "working" or waiting,
//   G) a plain group (no leader) stays a conversation: one reply after the other.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-parallel-test");
const PORT = 3308;
const MODEL_PORT = 3398;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-parallel-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIMIT = 2; // the server's "calls at once" for this account
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, maxConcurrent: LIMIT, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 } };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const call = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, input }], "tool_use");
const systemOf = (b) => (typeof b.system === "string" ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("\n") : "");

const seen = { spans: [], inflight: 0, peak: 0, refused: 0, systems: {}, views: {}, turns: {}, leadViews: [] };
const TEAM = ["Amel", "Badr", "Chems"];
const DELAY = { Amel: 500, Badr: 150, Chems: 300, Lead: 50 };

/** What the scripted model answers, and how long it "thinks". */
function answer(body) {
  const sys = systemOf(body);
  const msgs = body.messages || [];
  const all = JSON.stringify(msgs);
  const last = msgs[msgs.length - 1] || {};
  const hasResult = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
  const prev = msgs[msgs.length - 2];
  const lastTool = hasResult && prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
  if (/learn from finished work/.test(sys)) return { out: text('{"lessons":[],"user":[],"skill":null}'), delay: 10, me: "review" };
  const me = (sys.match(/You are (\w+)/) || [])[1] || "?";
  // The latest task marker in the conversation decides the scene.
  const scene = (all.match(/(WORK|ASK|FAIL|HALT|TALK):(?![\s\S]*(?:WORK|ASK|FAIL|HALT|TALK):)/) || [])[1] || "";
  if (!hasResult) seen.turns[`${scene}:${me}`] = (seen.turns[`${scene}:${me}`] || 0) + 1;
  seen.systems[`${scene}:${me}`] = sys;
  const delay = DELAY[me] ?? 50;

  if (me === "Lead") {
    seen.leadViews.push({ scene, view: all });
    const now = all.slice(all.lastIndexOf(`${scene}:`)); // this task only, not earlier ones
    const heard = TEAM.filter((n) => new RegExp(`\\[${n}\\]: ${scene}-DONE`).test(now));
    const failed = /couldn't finish this part/.test(now);
    if (heard.length || failed) return { out: text(`${scene}-FINAL: heard ${heard.join(",") || "nobody"}${failed ? "; one part failed" : ""}.`), delay, me };
    return { out: text(`${scene} plan. @Amel: part one. @Badr: part two. @Chems: part three.`), delay, me };
  }
  if (TEAM.includes(me)) {
    seen.views[`${scene}:${me}`] = all;
    if (scene === "FAIL" && me === "Badr") return { fail: true, delay, me };
    if (scene === "HALT") return { out: lastTool ? text("HALT-DONE") : call("work_table", { action: "add", table: "Halt", columns: ["Name"], rows: [[`${me} ${Date.now()}`]] }), delay: 1500, me };
    if (scene === "ASK" && me !== "Chems") {
      if (lastTool === "save_skill") return { out: text(`ASK-DONE by ${me}`), delay, me };
      return { out: call("save_skill", { name: `${me} method`, description: `How ${me} does it`, instructions: "1. Do it well." }), delay, me };
    }
    if (lastTool === "work_table") return { out: text(`${scene}-DONE by ${me}`), delay, me };
    return { out: call("work_table", { action: "add", table: "Shared", columns: ["Name", "By"], rows: [[`${scene} item of ${me}`, me]] }), delay, me };
  }
  if (me === "Xena" || me === "Yanis") {
    seen.spans.push({ me, scene, start: Date.now(), end: Date.now() });
    return { out: text(me === "Xena" && !/\[Yanis\]/.test(all) ? "TALK from Xena. @Yanis, what do you think?" : `TALK reply from ${me}.`), delay: 200, me };
  }
  return { out: text("ok"), delay: 10, me };
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
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        // Like the real server: a call beyond the account's limit is refused as "busy".
        if (seen.inflight >= LIMIT) {
          seen.refused++;
          return send(429, { error: "Too many requests at once.", code: "busy" });
        }
        seen.inflight++;
        seen.peak = Math.max(seen.peak, seen.inflight);
        const start = Date.now();
        let a;
        try {
          a = answer(JSON.parse(raw));
        } catch (e) {
          seen.inflight--;
          return send(400, { error: String(e) });
        }
        await sleep(a.delay);
        seen.inflight--;
        if (TEAM.includes(a.me)) seen.spans.push({ me: a.me, start, end: Date.now() });
        if (a.fail) return send(500, { error: "The model crashed on this request." });
        return send(200, a.out);
      }
      return send(204);
    });
  })
  .listen(MODEL_PORT, "127.0.0.1");

let server = null;
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: `http://127.0.0.1:${MODEL_PORT}`, PORT: String(PORT) },
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
async function idle(chatId, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const c = await api("GET", `/api/chats/${chatId}`);
    if (!c.running) return c;
    await sleep(150);
  }
  throw new Error(`chat ${chatId} still running`);
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const face = { color: 1, shape: 0, hair: 0, eyes: 0, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 };
const newBot = (name) => api("POST", "/api/bots", { name, role: "", instructions: `You are ${name}.`, face, tools: { web: true, browser: false } });
const overlap = (a, b) => a.start < b.end && b.start < a.end;

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  const lead = await newBot("Lead");
  const [amel, badr, chems] = [await newBot("Amel"), await newBot("Badr"), await newBot("Chems")];
  const ids = { [amel.id]: "Amel", [badr.id]: "Badr", [chems.id]: "Chems", [lead.id]: "Lead" };
  const team = await api("POST", "/api/chats", { name: "Squad", memberIds: [lead.id, amel.id, badr.id, chems.id], leadId: lead.id });
  const since = (c, n) => c.entries.slice(n).filter((e) => e.kind === "bot");
  const names = (list) => list.map((e) => `${ids[e.botId]}:${e.status}`).join(" ");

  // ---------- A, B, C: three teammates at once ----------
  let n = 0;
  const t0 = Date.now();
  await api("POST", `/api/chats/${team.id}/run`, { text: "WORK: split this in three" });
  let c = await idle(team.id);
  const took = Date.now() - t0;
  let bots = since(c, n);
  const mates = bots.filter((e) => e.botId !== lead.id);
  const spans = seen.spans.filter((s) => TEAM.includes(s.me));
  const pairs = [["Amel", "Badr"], ["Amel", "Chems"], ["Badr", "Chems"]].filter(([x, y]) => spans.some((a) => a.me === x && spans.some((b) => b.me === y && overlap(a, b))));
  check("A) the three teammates' model calls overlap in time (they work at the same time)", pairs.length >= 2 && new Set(mates.map((e) => e.batch)).size === 1 && !!mates[0]?.batch, `overlapping pairs: ${pairs.map((p) => p.join("+")).join(", ")}; took ${took} ms`);
  check("A) everyone finished and the leader answered once, after all three", names(bots) === "Lead:done Amel:done Badr:done Chems:done Lead:done" && bots.at(-1).text === "WORK-FINAL: heard Amel,Badr,Chems.", `${names(bots)} | ${bots.at(-1)?.text}`);
  check("B) never more calls at once than the server allows, and none was refused as busy", seen.peak === LIMIT && seen.refused === 0, `peak ${seen.peak} (limit ${LIMIT}), refused ${seen.refused}`);
  // Badr is the fastest: he was done while Amel was still working. Amel must not have seen his reply.
  check("C) while working, a teammate doesn't see the others' replies", !/\[Badr\]: WORK-DONE/.test(seen.views["WORK:Amel"]) && !/\[Chems\]: WORK-DONE/.test(seen.views["WORK:Amel"]));
  check("C) each is told the others work at the same time and to stay in their own part", /@Badr, @Chems are working on their parts right now, at the same time as you/.test(seen.systems["WORK:Amel"]) && /don't @mention them/.test(seen.systems["WORK:Amel"]));
  const work = JSON.parse(fs.readFileSync(path.join(DATA, "accounts", "p1test", "work", `${team.id}.json`), "utf8"));
  check("C) all three added to the same table without losing a row", work.tables.Shared.rows.length === 3 && TEAM.every((x) => work.tables.Shared.rows.some((r) => r[1] === x)), JSON.stringify(work.tables.Shared.rows));
  check("no pending work is left behind", !c.pending && !c.running);

  // ---------- D: two need the user's OK at the same moment ----------
  n = c.entries.length;
  await api("POST", `/api/chats/${team.id}/run`, { text: "ASK: each save your method" });
  c = await idle(team.id);
  bots = since(c, n);
  const card1 = c.pending?.approval;
  check("D) the run pauses with ONE card (the first teammate's); the other waits its turn; the third is done", !!card1 && ids[card1.botId] === "Amel" && (c.pending.parked || []).length === 1 && names(bots) === "Lead:done Amel:waiting Badr:waiting Chems:done", `${names(bots)}; parked ${(c.pending?.parked || []).length}`);
  check("D) the leader hasn't been asked for a final answer yet", (seen.turns["ASK:Lead"] || 0) === 1);
  await api("POST", `/api/chats/${team.id}/run`, { decisions: Object.fromEntries(card1.items.map((it) => [it.call.id, true])) });
  c = await idle(team.id);
  bots = since(c, n);
  const card2 = c.pending?.approval;
  check("D) after the first OK, the second teammate's card appears (nobody is skipped)", !!card2 && ids[card2.botId] === "Badr" && !(c.pending.parked || []).length && names(bots) === "Lead:done Amel:done Badr:waiting Chems:done", `${names(bots)}; card for ${ids[card2?.botId]}`);
  check("D) still no final answer while a teammate waits", (seen.turns["ASK:Lead"] || 0) === 1);
  await api("POST", `/api/chats/${team.id}/run`, { decisions: Object.fromEntries(card2.items.map((it) => [it.call.id, false])) });
  c = await idle(team.id);
  bots = since(c, n);
  check("D) once both are answered (one yes, one no), the leader closes with everyone's work", names(bots) === "Lead:done Amel:done Badr:done Chems:done Lead:done" && bots.at(-1).text === "ASK-FINAL: heard Amel,Badr,Chems." && !c.pending, `${names(bots)} | ${bots.at(-1)?.text}`);
  const skills = await api("GET", "/api/skills");
  const skillNames = JSON.stringify(skills);
  check("D) the approved skill was saved and the declined one wasn't", /Amel method/.test(skillNames) && !/Badr method/.test(skillNames));

  // ---------- E: one teammate fails ----------
  n = c.entries.length;
  await api("POST", `/api/chats/${team.id}/run`, { text: "FAIL: split this in three" });
  c = await idle(team.id);
  bots = since(c, n);
  check("E) one teammate's failure doesn't lose the others' work: the leader still answers", names(bots) === "Lead:done Amel:done Badr:error Chems:done Lead:done" && bots.at(-1).text === "FAIL-FINAL: heard Amel,Chems; one part failed." && !c.pending, `${names(bots)} | ${bots.at(-1)?.text}`);

  // ---------- F: Stop ----------
  n = c.entries.length;
  const halting = api("POST", `/api/chats/${team.id}/run`, { text: "HALT: long work" }); // (the request stays open until the run ends)
  await sleep(1200); // the three are in their first (slow) call
  const mid = await api("GET", `/api/chats/${team.id}`);
  const midRunning = since(mid, n).filter((e) => e.status === "running").length;
  await api("DELETE", `/api/chats/${team.id}/run`);
  await halting;
  c = await idle(team.id, 20000);
  bots = since(c, n);
  check("F) several teammates show as working at the same moment", midRunning === 3, `${midRunning} working`);
  check("F) Stop stops everyone: nothing is left working or waiting", bots.filter((e) => e.botId !== lead.id).every((e) => e.status === "stopped") && !c.pending && !c.running, names(bots));
  await sleep(2500);
  check("F) after Stop, no call is left running against the server", seen.inflight === 0);

  // ---------- G: a plain group stays a conversation ----------
  const x = await newBot("Xena");
  const y = await newBot("Yanis");
  const talk = await api("POST", "/api/chats", { name: "Talk", memberIds: [x.id, y.id], orchestrate: false });
  await api("POST", `/api/chats/${talk.id}/run`, { text: "TALK: @Xena @Yanis your views?" });
  const tc = await idle(talk.id);
  const tb = tc.entries.filter((e) => e.kind === "bot");
  check("G) a group without a leader answers one after the other (no batch)", tb.length >= 2 && tb.every((e) => !e.batch) && tb.every((e) => e.status === "done"), tb.map((e) => `${e.botId === x.id ? "Xena" : "Yanis"}:${e.status}`).join(" "));

  const ok = results.filter((r) => r.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
