// Real-model evals: the tasks that failed for real users, run on the hosted model and graded on what
// actually happened (who got an email, how many cards, questions, model calls and credits), never on what a
// prompt says. The other scenarios in tests/e2e use a scripted stand-in model: they prove the plumbing, not
// that a bot does the job. A change to the harness isn't done until these pass.
//
//   node tests/evals/run.cjs                 every scenario
//   node tests/evals/run.cjs bulk-all        one or more by id
//
// Needs: the built server (npm run build) and an oovi account signed in on this computer (the desktop app's
// session is copied into a throwaway data folder). Costs real credits: about 5 to 25 per scenario.
// Safe: the account service is reached through proxy.cjs, which lets only model calls through (no setup
// sync, no cloud sync, no reports), and "Zapier" is zapier-standin.cjs on this computer: nothing is sent.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "../..");
/** The built server to test: this checkout's, or another build's (EVAL_SERVER=<its .next/standalone>) to compare. */
const SERVER = process.env.EVAL_SERVER || path.join(ROOT, ".next/standalone");
const REAL = process.env.OOVI_REAL_DATA || path.join(os.homedir(), process.platform === "win32" ? "AppData/Roaming/oovi/data" : process.platform === "darwin" ? "Library/Application Support/oovi/data" : ".config/oovi/data");
const OUT_ROOT = process.env.EVAL_OUT || path.join(os.tmpdir(), "oovi-evals");
const LEADS = path.join(__dirname, "fixtures", "Leads web design.xlsx");
const ROWS = JSON.parse(fs.readFileSync(LEADS.replace(/\.xlsx$/, ".rows.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (a) => a.map((x) => String(x).toLowerCase());

/** A scenario stops once it has spent this much (a harness that only talks would go on for a long time). */
const MAX_CREDITS = Number(process.env.EVAL_MAX_CREDITS) || 60;

const LAW = /قانون|18-05|\bloi\b|\blaw\b|legal|juridique|rgpd|gdpr|spam/i;

/** What a user who just wants the job done answers to a question card. */
const JUST_DO_IT = "قررها انت وكمل";

/**
 * A chat as a long-time user has it: old errands that are over (a song on YouTube, a Facebook post), a summary
 * written by the earlier version of oovi with an "Open items" list, and a few recent messages. The first answer
 * to a new request used to return to these.
 */
function oldHistory(botId) {
  const t0 = Date.now() - 3 * 864e5;
  const user = (id, text, k) => ({ id, kind: "user", text, at: t0 + k * 60_000 });
  const bot = (id, text, k) => ({ id, kind: "bot", botId, at: t0 + k * 60_000 + 20_000, steps: [{ role: "assistant", text, toolCalls: [] }], text, status: "done", usage: { input: 0, output: 0 } });
  const entries = [
    user("u0001", "شغل أغنية في يوتوب", 1),
    bot("b0001", "باش نشغل أغنية في يوتوب نحتاج نتحكم في المتصفح تاعك. أي أغنية تحب؟", 1),
    user("u0002", "دير بوست فيسبوك على مشروع m3ak", 30),
    bot("b0002", "واش تحب نكتب في البوست؟ أعطيني النقاط الأساسية وأنا نكتبو.", 30),
    user("u0003", "خليها من بعد", 31),
    bot("b0003", "ماشي، كي تحب.", 31),
    user("u0004", "شحال الساعة في طوكيو درك؟", 2000),
    bot("b0004", "الساعة في طوكيو درك تقريباً 9 تاع الليل.", 2000),
    user("u0005", "شكرا", 2001),
    bot("b0005", "العفو، أي وقت.", 2001),
  ];
  const summary = {
    upTo: "b0003",
    text: [
      "## Goals", "- The user runs a project called m3ak and wants help with its social media.",
      "## Done so far", "- Nothing was completed.",
      "## Open items",
      "- Play a song on YouTube: the user asked; the assistant asked which song; no answer yet.",
      "- Facebook post about the m3ak project: waiting for the user's key points.",
      "- No clear instruction was given for the YouTube channel.",
    ].join("\n"),
  };
  return { entries, summary };
}

const OLD_TOPICS = /youtube|يوتوب|يوتيوب|facebook|فيسبوك|فايسبوك|m3ak|أغنية|اغنية|chanson|song|طوكيو|tokyo/i;

const SCENARIOS = [
  {
    id: "bulk-all",
    title: "1,001-line workbook: \"send an email to everyone in the list\"",
    zapier: { enabled: true, connected: true },
    steps: [{ say: "ابعث إيمايل لكل واحد في القائمة", file: LEADS }],
    expected: () => ROWS.filter((r) => r.email).map((r) => r.email),
    limits: { cards: 1, questions: 1, calls: 10, credits: 12 },
  },
  {
    id: "bulk-all-refused",
    title: "the user says everyone, including the ones marked refused",
    zapier: { enabled: true, connected: true },
    steps: [{ say: "ابعث إيمايل للكل بلا استثناء، حتى اللي Statut تاعهم Refusé. اعرض عليهم تصميم موقع ويب.", file: LEADS }],
    expected: () => ROWS.filter((r) => r.email).map((r) => r.email),
    limits: { cards: 1, questions: 0, calls: 10, credits: 12 },
  },
  {
    id: "bulk-filter",
    title: "only the rows with one status",
    zapier: { enabled: true, connected: true },
    steps: [{ say: "Envoie un email à tous ceux dont le statut est « Intéressé » dans la liste, pour leur proposer un rendez-vous cette semaine.", file: LEADS }],
    expected: () => ROWS.filter((r) => r.email && r.status === "Intéressé").map((r) => r.email),
    limits: { cards: 1, questions: 0, calls: 10, credits: 12 },
  },
  {
    id: "old-topics",
    title: "a new request in a chat full of old errands: the answer is about the new request only",
    zapier: { enabled: true, connected: true },
    seed: oldHistory,
    steps: [{ say: "ابعث إيمايل لكل واحد في القائمة", file: LEADS }],
    expected: () => ROWS.filter((r) => r.email).map((r) => r.email),
    noOldTopics: true,
    limits: { cards: 1, questions: 1, calls: 10, credits: 12 },
  },
  {
    id: "single-connect",
    title: "one email while Gmail isn't connected yet: a card to connect it, then the email goes by itself",
    zapier: { enabled: false, connected: false },
    connectsAfterMs: 5000,
    steps: [{ say: "ابعث إيمايل لكريم على karim@menuiseriebenali.dz وقلو الاجتماع تاع غدوة تبدل للعشرة تاع الصباح" }],
    // A build without the connect card leaves it to the user: they connect on Zapier's page and say so.
    ifNotDone: { before: { connected: true, enabled: true }, say: "connecté" },
    expected: () => ["karim@menuiseriebenali.dz"],
    // Two cards: connect Gmail, then the email itself. No second message from the user.
    limits: { cards: 2, questions: 0, calls: 8, credits: 8 },
  },
];

async function runScenario(sc, k) {
  const out = path.join(OUT_ROOT, sc.id);
  fs.rmSync(out, { recursive: true, force: true });
  const data = path.join(out, "data");
  fs.mkdirSync(data, { recursive: true });
  for (const f of ["session.json", ".device-key"]) {
    fs.copyFileSync(path.join(REAL, f), path.join(data, f));
    fs.chmodSync(path.join(data, f), 0o600);
  }
  const uid = JSON.parse(fs.readFileSync(path.join(data, "session.json"), "utf8")).user.id;
  fs.mkdirSync(path.join(data, "accounts", uid), { recursive: true });
  fs.writeFileSync(path.join(data, "accounts", uid, "cloud-sync.json"), JSON.stringify({ enabled: false, asked: true }));
  fs.writeFileSync(path.join(out, "zapier-state.json"), JSON.stringify(sc.zapier));
  const base = Number(process.env.EVAL_PORT) || 4710;
  const [PORT, PROXY, ZAP] = [base + k * 3, base + 1 + k * 3, base + 2 + k * 3];
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, LAB_OUT: out, PROXY_PORT: String(PROXY), ZAP_PORT: String(ZAP) };
  const log = fs.openSync(path.join(out, "server.log"), "w");
  const kids = [
    spawn("node", [path.join(__dirname, "proxy.cjs")], { env, stdio: ["ignore", log, log] }),
    spawn("node", [path.join(__dirname, "zapier-standin.cjs")], { env, stdio: ["ignore", log, log] }),
    spawn("node", ["server.js"], { cwd: SERVER, env: { ...env, OOVI_DATA: data, OOVI_DOWNLOADS: path.join(out, "downloads"), OOVI_CLOUD_URL: `http://127.0.0.1:${PROXY}`, HOSTNAME: "127.0.0.1", PORT: String(PORT), OOVI_VERSION: "eval" }, stdio: ["ignore", log, log] }),
  ];
  const api = async (method, p, body, headers) => {
    const r = await fetch(BASE + p, { method, headers: { ...(body && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}), ...(headers || {}) }, body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined });
    const t = await r.text();
    try { return { status: r.status, j: JSON.parse(t) }; } catch { return { status: r.status, j: null, t }; }
  };
  // prompts: each time the app stopped to ask for an OK (one card can hold several actions of the same step).
  const seen = { cards: [], prompts: 0, questions: 0, plans: 0, texts: [], said: [] };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/bots`)).ok) break; } catch {} await sleep(500); }
    await api("POST", "/api/settings", { active: "oovi" });
    const add = await api("POST", "/api/mcp", { name: "Zapier", transport: "http", url: `http://127.0.0.1:${ZAP}/mcp` });
    const main = (await api("GET", "/api/main")).j;
    const got = (await api("GET", `/api/bots/${main.botId}`)).j;
    const bot = got.bot || got;
    await api("PUT", `/api/bots/${main.botId}`, { ...bot, tools: { ...bot.tools, mcp: [add.j.id] } });
    const chat = `dm-${main.botId}`;
    if (sc.seed) {
      // getChat reads the file each time: an earlier conversation is put there before the first message.
      const now = (await api("GET", `/api/chats/${chat}`)).j;
      const { entries, summary } = sc.seed(main.botId);
      fs.writeFileSync(path.join(data, "accounts", uid, "chats", `${chat}.json`), JSON.stringify({ id: chat, kind: "direct", name: "", memberIds: [main.botId], leadId: main.botId, createdAt: now.createdAt, updatedAt: Date.now(), entries, summary }));
    }
    const post = async (body) => { const r = await fetch(`${BASE}/api/chats/${chat}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); await r.text(); };
    const idle = async () => { for (let i = 0; i < 3600; i++) { const c = (await api("GET", `/api/chats/${chat}`)).j; if (c && !c.running) return c; await sleep(500); } throw new Error("the run didn't end in 30 minutes"); };

    const spent = () => { try { return fs.readFileSync(path.join(out, "calls.jsonl"), "utf8").trim().split("\n").reduce((a, l) => a + (JSON.parse(l).credits || 0), 0); } catch { return 0; } };
    const sentSoFar = () => { try { return fs.readFileSync(path.join(out, "sent.jsonl"), "utf8").trim().split("\n").filter(Boolean).length; } catch { return 0; } };
    const steps = [...sc.steps];
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si];
      seen.userMessages = si + 1;
      if (step.before) await fetch(`http://127.0.0.1:${ZAP}/state?${Object.entries(step.before).map(([a, b]) => `${a}=${b ? 1 : 0}`).join("&")}`);
      const ids = [];
      if (step.file) {
        const up = await api("POST", `/api/chats/${chat}/attachments`, fs.readFileSync(step.file), { "x-file-name": encodeURIComponent(path.basename(step.file)), "content-type": "application/octet-stream" });
        ids.push(up.j.attachment.id);
      }
      await post({ text: step.say, ...(ids.length ? { attachments: ids } : {}) });
      // The user the scenario plays: approves what the app asks, and to a question says "you decide, go on".
      for (let turn = 0; turn < 12; turn++) {
        const c = await idle();
        // A run that only burns credits is cut short: the result says so.
        if (spent() > MAX_CREDITS) { seen.cut = true; break; }
        const p = c.pending || {};
        if (p.approval) {
          seen.prompts++;
          for (const it of p.approval.items) seen.cards.push({ tool: it.call.name, summary: String(it.summary).slice(0, 400) });
          // The card to connect an app: the user connects it on the page that opens (here, a few seconds later).
          if (sc.connectsAfterMs && p.approval.items.some((it) => it.call.name === "connect_app")) setTimeout(() => void fetch(`http://127.0.0.1:${ZAP}/state?connected=1&enabled=1`).catch(() => {}), sc.connectsAfterMs);
          await post({ decisions: Object.fromEntries(p.approval.items.map((it) => [it.call.id, true])) });
        } else if (p.planReview) {
          seen.plans++;
          const e = c.entries.find((x) => x.id === p.planReview.entryId);
          await post({ planDecision: { approve: true, items: (e.plan || []).map((x) => x.text) } });
        } else if (p.questions) {
          const e = c.entries.find((x) => x.id === p.questions.entryId);
          seen.questions += e.questions.items.length;
          seen.said.push(JSON.stringify(e.questions), e.text || "");
          await post({ answers: e.questions.items.map(() => JUST_DO_IT) });
        } else break;
      }
      const c = await idle();
      const last = [...c.entries].reverse().find((e) => e.kind === "bot");
      seen.texts.push(last?.text || last?.error || "");
      // Everything the bots said to the user since the scenario's first message (what was there before doesn't count).
      const from = sc.seed ? c.entries.findIndex((e) => e.kind === "user" && e.text === sc.steps[0].say) : 0;
      for (const e of c.entries.slice(Math.max(0, from))) if (e.kind === "bot") seen.said.push(e.text || "");
      if (si === steps.length - 1 && sc.ifNotDone && !sentSoFar() && !seen.usedFallback) { seen.usedFallback = true; steps.push(sc.ifNotDone); }
      if (seen.cut) break;
    }
    await sleep(800);
  } finally {
    kids.forEach((x) => x.kill());
    fs.closeSync(log);
  }

  const read = (f) => { try { return fs.readFileSync(path.join(out, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const calls = read("calls.jsonl");
  const sent = lower(read("sent.jsonl").flatMap((s) => s.to));
  const want = new Set(lower(sc.expected()));
  const got = new Set(sent);
  const prompt = (l) => (l.in || 0) + (l.cacheRead || 0) + (l.cacheWrite || 0);
  const m = {
    reached: [...want].filter((x) => got.has(x)).length,
    wanted: want.size,
    invented: [...got].filter((x) => !want.has(x)).length,
    twice: sent.length - got.size,
    cards: seen.prompts,
    actionsOnCards: seen.cards.length,
    questions: seen.questions,
    plans: seen.plans,
    botCalls: calls.filter((l) => l.tools > 0).length,
    sideCalls: calls.filter((l) => !l.tools).length,
    credits: Math.round(calls.reduce((a, l) => a + (l.credits || 0), 0) * 10) / 10,
    maxPrompt: Math.max(0, ...calls.map(prompt)),
    lecture: seen.said.filter((t) => LAW.test(t)).length,
    userMessages: seen.userMessages || sc.steps.length,
    cutShort: !!seen.cut,
  };
  const checks = [
    [`every wanted address got the email (${m.reached} of ${m.wanted})`, m.reached === m.wanted],
    [`no address outside the wanted ones (${m.invented})`, m.invented === 0],
    [`nobody written to twice (${m.twice})`, m.twice === 0],
    [`at most ${sc.limits.cards} approval card (${m.cards}${seen.cards.length ? `: ${seen.cards.map((x) => x.tool.replace(/^mcp_zapier_/, "")).join(", ")}` : ""})`, m.cards <= sc.limits.cards],
    [`at most ${sc.limits.questions} question to the user (${m.questions}), no plan to approve (${m.plans})`, m.questions <= sc.limits.questions && m.plans === 0],
    [`at most ${sc.limits.calls} model calls by the bot (${m.botCalls}, plus ${m.sideCalls} side calls)`, m.botCalls <= sc.limits.calls],
    [`at most ${sc.limits.credits} credits (${m.credits})`, m.credits <= sc.limits.credits],
    [`no request over 100,000 tokens (largest ${m.maxPrompt})`, m.maxPrompt <= 100_000],
    [`no lecture in the answers (${m.lecture})`, m.lecture === 0],
    ...(sc.noOldTopics ? [[`nothing about the old topics in what the bots said (${seen.said.filter((t) => OLD_TOPICS.test(t)).length})`, !seen.said.some((t) => OLD_TOPICS.test(t))]] : []),
  ];
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ id: sc.id, metrics: m, checks, cards: seen.cards, texts: seen.texts }, null, 1));
  return { m, checks, texts: seen.texts };
}

(async () => {
  if (!fs.existsSync(path.join(REAL, "session.json"))) return console.error(`No oovi session in ${REAL}: sign in to the desktop app first (or set OOVI_REAL_DATA).`), process.exit(2);
  if (!fs.existsSync(path.join(SERVER, "server.js"))) return console.error("No built server: run `npm run build` first."), process.exit(2);
  const pick = process.argv.slice(2);
  const list = SCENARIOS.filter((s) => !pick.length || pick.includes(s.id));
  let failed = 0;
  const rows = [];
  for (const [k, sc] of list.entries()) {
    console.log(`\n=== ${sc.id}: ${sc.title}`);
    let r;
    try {
      r = await runScenario(sc, k);
    } catch (e) {
      console.log(`  ERROR ${e.message}`);
      failed++;
      continue;
    }
    for (const [name, ok] of r.checks) {
      console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
      if (!ok) failed++;
    }
    console.log(`  last answer: ${String(r.texts.at(-1)).replace(/\s+/g, " ").slice(0, 260)}`);
    rows.push({ id: sc.id, ...r.m });
  }
  console.log("\n" + ["scenario", "reached", "invented", "cards", "questions", "bot calls", "credits"].join(" | "));
  for (const r of rows) console.log([r.id, `${r.reached}/${r.wanted}`, r.invented, r.cards, r.questions, r.botCalls, `${r.credits}${r.cutShort ? " (cut short)" : ""}`].join(" | "));
  console.log(`\nresults in ${OUT_ROOT}`);
  process.exit(failed ? 1 : 0);
})();
