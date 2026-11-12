// End-to-end replay of a real conversation that went wrong, against the built oovi server, with a
// scripted stand-in for theOovi's model (port 3396; nothing leaves this machine). What happened then:
// the Chief asked a group without a leader (c, mouloud) for a dashboard link; c posted it, then c and
// mouloud passed the turn back and forth agreeing with each other, mouloud spoke last, and the Chief
// told the user "c didn't answer". Checked here:
//   A) the Chief gets the link even though another bot spoke last,
//   B) agreeing / thanking / referring to a teammate doesn't pass the turn (no ping-pong),
//   C) a leader's "Great work @Scout!" in its final answer doesn't send Scout back to work,
//   D) the prompts carry the short-message, @-mention and language rules.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-group-test");
const PORT = 3305;
const MODEL_PORT = 3396;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-group-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LINK = "https://profiles-test-dashboard.trycloudflare.com";
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 }, desktop: false };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const textOf = (m) => (Array.isArray(m.content) ? m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? JSON.stringify(b.content) : "")).join(" ") : String(m.content || ""));
const systemOf = (b) => (typeof b.system === "string" ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("\n") : "");

const seen = { systems: {}, tools: {}, chiefResult: "", turns: {} };

function answer(body) {
  const sys = systemOf(body);
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const all = msgs.map(textOf).join(" ");
  // The user's latest message (not tool results), so an old request isn't taken for the new one.
  const ask = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== "user") continue;
      const t = typeof m.content === "string" ? m.content : (m.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      if (t.trim()) return t;
    }
    return "";
  })();
  const me = (sys.match(/You are (\w+)/) || [])[1] || "?";
  seen.systems[me] = sys;
  seen.tools[me] = body.tools || [];
  const mgSpec = (body.tools || []).find((t) => t.name === "message_group");
  if (mgSpec) seen.messageGroup = mgSpec;
  seen.turns[me] = (seen.turns[me] || 0) + 1;

  // The owner's "use my pc and check my gmail" case: the Chief gives the group a job that needs the user's OK.
  // The request must come back to the chat the user is in, and the user's own words must reach the group.
  if (/ASKME:/.test(all)) {
    if (me === "Oovi" && (body.tools || []).some((t) => t.name === "message_group")) {
      if (results.length) {
        seen.askResult = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
        return text("ASK-RELAYED");
      }
      // The Chief rewords the task into something smaller, as it did in the real conversation.
      return reply([{ type: "tool_use", id: `toolu_ask_${Date.now()}`, name: "message_group", input: { group: "Business", message: "@c check whether a method exists; if not, stop." } }], "tool_use");
    }
    if (me === "c") {
      seen.askView = all;
      if (results.length) return text(`ASK-DONE: ${/declined/i.test(JSON.stringify(results)) ? "not saved" : "saved"}`);
      return reply([{ type: "tool_use", id: `toolu_sk_${Date.now()}`, name: "save_skill", input: { name: "Inbox check", description: "How to check the inbox", instructions: "1. Open the inbox." } }], "tool_use");
    }
  }
  // The Chief, in its direct chat: ask the group, then report what came back.
  if (me === "Oovi" && /DASH:/.test(all) && (body.tools || []).some((t) => t.name === "message_group")) {
    if (results.length) {
      seen.chiefResult = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
      return text(`CHIEF-SAW: ${seen.chiefResult.includes(LINK) ? "the link" : "no link"}`);
    }
    return reply([{ type: "tool_use", id: `toolu_mg_${Date.now()}`, name: "message_group", input: { group: "Business", message: "@c please send the Business OS dashboard link." } }], "tool_use");
  }
  // The group without a leader, as it went that day.
  if (me === "c") {
    if (/mouloud\]: /.test(all)) return text("Merci @mouloud, ta correction est juste. @mouloud a raison : relance le Business OS."); // would bounce back before the fix
    return text(`Voici le lien du Business OS : ${LINK}\nCorrection : la deadline de m3ak est le 12 nov, pas demain comme l'a écrit @mouloud.\n@mouloud, peux-tu vérifier que le lien s'ouvre ?`);
  }
  if (me === "mouloud") return text("Marys, le dashboard s'ouvre vide. @c a raison : il faut relancer le Business OS. Merci @c.");
  // A group with a leader: one hand-off, then a final answer that thanks the teammate.
  if (me === "Oovi" && /TEAM:/.test(all)) {
    if (/PRICES:/.test(all)) return text("Great work @Scout! Final: three cafés nearby, 150-300 DA.");
    return text("@Scout please list the cafés near us and their prices.");
  }
  // A recurring request in Darija, to a bot that isn't the main bot (the routine screenshot).
  if (me === "Scout" && /مل يوم/.test(ask)) {
    seen.routineRule = /propose_routine/.test(sys) && /كل يوم/.test(sys);
    if (results.length) return text("OK");
    if (!(body.tools || []).some((t) => t.name === "propose_routine")) return text("صباح الخير!"); // what happened before the fix
    return reply([{ type: "tool_use", id: `toolu_rt_${Date.now()}`, name: "propose_routine", input: { name: "Good morning", instruction: "Say good morning to the user in Darija.", frequency: "daily", time: "10:00" } }], "tool_use");
  }
  if (me === "Scout" && /SNEAKY:/.test(ask)) {
    seen.scoutTools = (body.tools || []).map((t) => t.name);
    if (results.length) return text(`SCOUT-GOT: ${JSON.stringify(results[0].content).slice(0, 120)}`);
    return reply([{ type: "tool_use", id: `toolu_sn_${Date.now()}`, name: "propose_team", input: { name: "Rogue", purpose: "x", members: ["Nova", "Quill"] } }], "tool_use");
  }
  if (me === "Scout") return text("PRICES: three cafés nearby, 150-300 DA.");
  if (me === "Quill" && /PERM:/.test(ask)) {
    seen.quillTools = (body.tools || []).map((t) => t.name);
    if (results.length) return text(`QUILL-AFTER: ${JSON.stringify(results[0].content).slice(0, 160)}`);
    return reply([{ type: "tool_use", id: `toolu_ab_${Date.now()}`, name: "request_abilities", input: { abilities: ["accounts"], why: "To post your text on your Facebook page." } }], "tool_use");
  }
  if (me === "Quill" && /TEAMUP:/.test(ask)) {
    if (results.length) return text(`TEAM-DONE: ${JSON.stringify(results[0].content).slice(0, 200)}`);
    return reply([{ type: "tool_use", id: `toolu_tm_${Date.now()}`, name: "propose_team", input: { name: "Launch", purpose: "Plan and run the launch posts.", members: ["Scout"], new_bots: [{ name: "Lina", role: "Social media copywriter", instructions: "You write short, warm Facebook posts in French and Arabic with a clear call to action." }], leader: "Scout" } }], "tool_use");
  }
  if (me === "Quill" && /FB:/.test(all)) return text("OK");
  return text("ok");
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
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        try {
          return send(200, answer(JSON.parse(raw)));
        } catch (e) {
          return send(400, { error: String(e) });
        }
      }
      if (url === "/api/v1/catalog") return send(200, { items: [] });
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
    await sleep(300);
  }
  throw new Error(`chat ${chatId} still running`);
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const face = { color: 1, shape: 0, hair: 0, eyes: 0, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 };
const newBot = (name, role, extra = "") => api("POST", "/api/bots", { name, role, instructions: `You are ${name}, a helpful teammate for the user's small business.${extra}`, face, tools: { web: false, browser: false } });

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  const bots = await api("GET", "/api/bots");
  const chief = bots[0];
  const scout = bots.find((b) => b.name === "Scout");
  await api("POST", "/api/main", { botId: chief.id });
  const c = await newBot("c", "Business analyst", ` The Business OS dashboard is at ${LINK}.`);
  const mouloud = await newBot("mouloud", "Personal assistant");
  const biz = await api("POST", "/api/chats", { name: "Business", memberIds: [c.id, mouloud.id], orchestrate: false });
  log(`chief ${chief.name}; group ${biz.name} (no leader): ${c.name}, ${mouloud.name}`);

  // A + B: the Chief asks the group for the link.
  await api("POST", `/api/chats/dm-${chief.id}/run`, { text: "DASH: ask @c for my dashboard link" });
  await idle(`dm-${chief.id}`);
  const g = await idle(biz.id);
  const said = g.entries.filter((e) => e.kind === "bot").map((e) => `${e.botId === c.id ? "c" : "mouloud"}: ${e.text.slice(0, 60)}`);
  check("c and mouloud don't bounce agreement back and forth (2 messages, not 5)", said.length === 2, said.join(" | "));
  check("c's link reaches the Chief although mouloud spoke last", seen.chiefResult.includes(LINK) && /Earlier messages in the group/.test(seen.chiefResult));
  const dm = await api("GET", `/api/chats/dm-${chief.id}`);
  check("the Chief reports the link instead of 'c didn't answer'", dm.entries.at(-1)?.text === "CHIEF-SAW: the link", dm.entries.at(-1)?.text);

  // C: a led group; the leader's thank-you mention doesn't send Scout back to work.
  const team = await api("POST", "/api/chats", { name: "Team", memberIds: [chief.id, scout.id], leadId: chief.id });
  const scoutTurns = seen.turns.Scout || 0;
  await api("POST", `/api/chats/${team.id}/run`, { text: "TEAM: compare café prices near us" });
  const t = await idle(team.id);
  const tb = t.entries.filter((e) => e.kind === "bot");
  check("the leader hands out work once and its 'Great work @Scout!' ends the task", (seen.turns.Scout || 0) - scoutTurns === 1 && tb.length === 3 && /^Great work/.test(tb.at(-1)?.text ?? ""), tb.map((e) => e.text.slice(0, 40)).join(" | "));

  // E: "every day at 10, tell me good morning" (Darija, with a typo) to a bot that isn't the main bot.
  await api("POST", `/api/chats/dm-${scout.id}/run`, { text: "مل يوم صباح على عشرة تاع صباح قلي صباح الخير" });
  const sd = await idle(`dm-${scout.id}`);
  const card = sd.pending?.approval?.items?.[0];
  check("a recurring request becomes a routine proposal, from any bot's own chat", !!card && /Good morning/.test(card.summary || ""), card?.summary || sd.entries.at(-1)?.text);
  check("bots are told that 'every day at…' (in Darija too) means a routine", seen.routineRule === true);

  // F: the owner's setup in the screenshots: Quill is the Chief with web search only; Scout has the browser.
  const quill = bots.find((b) => b.name === "Quill");
  await api("PUT", `/api/bots/${quill.id}`, { ...quill, tools: { web: true, browser: false } });
  await api("PUT", "/api/main", { botId: quill.id });
  await api("POST", `/api/chats/dm-${quill.id}/run`, { text: "FB: can you post on my Facebook? I can log in for you" });
  await idle(`dm-${quill.id}`);
  const qs = seen.systems.Quill || "";
  check("Quill knows its real abilities (web search, no browser) and doesn't claim others", /from your settings right now: web search\./.test(qs) && /can't open websites/.test(qs), (qs.match(/Your abilities[^\n]*/) || [""])[0].slice(0, 160));
  check("Quill gives the exact steps to turn on posting", /turn on "Browser" and "Use my signed-in accounts"/.test(qs) && /Settings → Your accounts/.test(qs));
  check("Quill can hand web tasks to the group that has Scout", /Scout is in "Team"[^\n]*message_group/.test(qs));
  const ss = seen.systems.Scout || "";
  check("Scout (browser, no accounts) is told the one missing setting, not to refuse", /turn on "Use my signed-in accounts"/.test(ss) && /don't just refuse/.test(ss) && !/turn on "Browser"/.test(ss));

  check("the Chief sees the link written in c's description", qs.includes(LINK) && /The user's bots/.test(qs));

  // G: Quill asks to turn on its signed-in accounts; nothing changes until the user clicks.
  await api("POST", `/api/chats/dm-${quill.id}/run`, { text: "PERM: post my text on Facebook" });
  let qd = await idle(`dm-${quill.id}`);
  const abCard = qd.pending?.approval?.items?.[0];
  const before = (await api("GET", "/api/bots")).find((b) => b.id === quill.id);
  check("a card asks to turn on Browser + accounts for Quill, with what it allows and why", !!abCard && /Browser \+ Use my signed-in accounts/.test(abCard.summary) && /Why: To post your text/.test(abCard.detail || "") && /every click and keystroke/.test(abCard.detail || ""), abCard?.summary);
  check("nothing changed before the click", before.tools.browser === false && !before.tools.accounts);
  await api("POST", `/api/chats/dm-${quill.id}/run`, { decisions: { [abCard.call.id]: true } });
  qd = await idle(`dm-${quill.id}`);
  const after = (await api("GET", "/api/bots")).find((b) => b.id === quill.id);
  check("after the click Quill has the browser and signed-in accounts", after.tools.browser === true && after.tools.accounts === true);
  check("Quill can use the browser from its very next step", (seen.quillTools || []).includes("open_url"), (seen.quillTools || []).filter((n) => /url|takeover/.test(n)).join(","));

  // H: the Chief builds a team with the user's OK.
  await api("POST", `/api/chats/dm-${quill.id}/run`, { text: "TEAMUP: make me a team for the launch and run it" });
  qd = await idle(`dm-${quill.id}`);
  const tmCard = qd.pending?.approval?.items?.[0];
  check("a card shows the proposed team (name, leader, members, new bot)", !!tmCard && /Create the team "Launch" \(2 bots\)/.test(tmCard.summary) && /Leader: Scout/.test(tmCard.detail || "") && /New bot: Lina, Social media copywriter/.test(tmCard.detail || ""), tmCard?.summary);
  check("no team or bot is created before the click", !(await api("GET", "/api/bots")).some((b) => b.name === "Lina"));
  await api("POST", `/api/chats/dm-${quill.id}/run`, { decisions: { [tmCard.call.id]: true } });
  await idle(`dm-${quill.id}`);
  const lina = (await api("GET", "/api/bots")).find((b) => b.name === "Lina");
  const launch = (await api("GET", "/api/chats")).find((x) => x.name === "Launch");
  check("after the click the team exists, led by Scout, with the new bot Lina", !!lina && !!launch && launch.memberIds.includes(lina.id) && launch.memberIds.includes(scout.id) && launch.leadId === scout.id && lina.tools.accounts !== true);

  // I: a bot that isn't the Chief can't build teams.
  await api("POST", `/api/chats/dm-${scout.id}/run`, { text: "SNEAKY: make a team" });
  const sk = await idle(`dm-${scout.id}`);
  check("only the Chief is offered propose_team; a call from another bot is refused", !(seen.scoutTools || []).includes("propose_team") && (seen.scoutTools || []).includes("request_abilities") && !sk.pending?.approval && !(await api("GET", "/api/chats")).some((x) => x.name === "Rogue"), sk.entries.at(-1)?.text);

  // D: the rules are in the prompts.
  check("group members are told to keep messages short and not repeat", /Group messages are short/.test(seen.systems.c || "") && /without @/.test(seen.systems.c || ""));
  check("every bot is told: answer first, a few lines", /Be short and practical/.test(seen.systems.Oovi || ""));
  const mg = seen.messageGroup;
  check("the Chief writes to groups in the user's language", /language of the user's latest message/.test(mg?.description || ""));

  // G: a group's request for the user's OK comes to the chat the user is in, and is answered there.
  const WORDS = "ASKME: use my pc and save the inbox method, exactly as I say";
  await api("PUT", "/api/main", { botId: chief.id }); // an earlier scene made another bot the main one
  await api("POST", `/api/chats/dm-${chief.id}/run`, { text: WORDS });
  let main = await idle(`dm-${chief.id}`);
  let grp = await idle(biz.id);
  const asks = main.groupAsks || [];
  const ask = asks[0];
  check("the group's request appears in the main bot's chat as a card", asks.length === 1 && ask.kind === "approval" && ask.groupName === "Business" && ask.approval.items.length === 1 && ask.approval.items[0].call.name === "save_skill" && ask.approval.botId === c.id, JSON.stringify(asks).slice(0, 200));
  check("the main bot is told the card is in this chat, never to send the user to the group", /shown to them as a card right here in this chat/.test(seen.askResult || "") && !/answer in the group|Open the group/.test(seen.askResult || ""), (seen.askResult || "").slice(0, 160));
  const sentTask = grp.entries.filter((e) => e.kind === "user").at(-1);
  check("the user's own words reach the group unchanged, next to the main bot's wording", sentTask?.userWords === WORDS && /check whether a method exists/.test(sentTask?.text || "") && (seen.askView || "").includes(`The user's own message, word for word. It is the task`) && (seen.askView || "").includes(WORDS), `${sentTask?.userWords} | ${sentTask?.text}`);
  check("other chats don't get the card (only the main bot's chat does)", !(grp.groupAsks || []).length && !((await api("GET", `/api/chats/dm-${scout.id}`)).groupAsks || []).length);
  // Answer from the main bot's chat: the decision goes to the group's run.
  const mainBefore = main.entries.length;
  await api("POST", `/api/chats/${biz.id}/run`, { decisions: Object.fromEntries(ask.approval.items.map((i) => [i.call.id, true])) });
  grp = await idle(biz.id);
  for (let i = 0; i < 40; i++) {
    main = await api("GET", `/api/chats/dm-${chief.id}`);
    if (main.entries.length > mainBefore && !main.running) break;
    await sleep(300);
  }
  check("answered from the main chat: the group goes on and finishes", grp.entries.at(-1)?.text === "ASK-DONE: saved" && !grp.pending, grp.entries.at(-1)?.text);
  check("the card is gone and the group's result arrives in the main chat", !(main.groupAsks || []).length && main.entries.length > mainBefore && /ASK-DONE: saved/.test(main.entries.at(-1)?.text || ""), `${(main.groupAsks || []).length} asks; last: ${(main.entries.at(-1)?.text || "").slice(0, 80)}`);
  check("the main bot is told to do a job itself when its own tools can", /Do the job yourself whenever your own tools can do it/.test(seen.systems.Oovi || "") && /only when it is big enough to split into parts/.test(seen.systems.Oovi || ""));

  const ok = results.filter((r) => r.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
