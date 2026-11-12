// Lists from web pages, in the bots' real browser, against the built oovi server with a scripted
// stand-in for theOovi's model (nothing leaves this machine: the pages are served here).
// The owner's case: a team asked for 50 cafés and salons with phone numbers had 12 after hours,
// reading pages one by one, and the main bot and its group each counted a different table.
// Checked here:
//   A) extract_list takes a whole directory list (it loads more as it scrolls, inside its own panel)
//      straight into a work table: names, phone numbers written bare or behind a "call" link, the
//      business's site, the source page; the page's menu is not mistaken for the list,
//   B) a second page of the same directory completes rows instead of repeating them,
//   C) scroll loads what comes next and shows it,
//   D) an HTML table is a list too; without `table` the items are shown, not saved,
//   E) a page without a list says so and what to try,
//   F) a job the main bot gives a group is done in the main bot's work files (one table, one count);
//      a message written in the group itself uses the group's own files,
//   G) bots are told to keep rows found on directories, with their source.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-list-test");
const PORT = 3315;
const MODEL_PORT = 3394;
const SITE_PORT = 3393;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const LOG = path.join(os.tmpdir(), "oovi-list-log.txt");
fs.writeFileSync(LOG, "");
const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the "directory" ----
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const NAV = `<nav><ul>${["Accueil", "Catégories", "Villes", "Ajouter une entreprise", "Contact annuaire"].map((x) => `<li><a href="/x">${x} de l'annuaire</a></li>`).join("")}</ul></nav>`;
// Item n: even numbers show the phone as plain text, odd ones behind a "call" link, every tenth has none.
const phone = (n) => `0550 10 ${String(Math.floor(n / 100)).padStart(2, "0")} ${String(n % 100).padStart(2, "0")}`;
const card = (n, kind = "Café") =>
  `<div class="card result"><h3><a href="/fiche/${n}">${kind} Numéro ${n}</a></h3><p>${kind} · Hydra, Alger</p>` +
  (n % 10 === 0 ? "" : n % 2 === 0 ? `<p>${phone(n)}</p>` : `<a class="btn" href="tel:+21355010${String(Math.floor(n / 100)).padStart(2, "0")}${String(n % 100).padStart(2, "0")}">Appeler</a>`) +
  `<a href="https://cafe${n}.example/">Site web</a><p>Ouvert · Ferme à 22:00 · 4,${n % 10} (1${n} avis)</p></div>`;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PAGES = {
  // 20 cards at first; 15 more each time the panel is scrolled to its end, up to 50.
  "/cafes": page(
    "Cafés à Alger",
    `${NAV}<h1>Cafés à Alger</h1><div id="panel" style="height:500px;overflow-y:auto"><div id="feed">${range(1, 20).map((n) => card(n)).join("")}</div></div>
     <footer><ul><li><a href="/a">Conditions générales de l'annuaire</a></li><li><a href="/b">Politique de confidentialité</a></li><li><a href="/c">Mentions légales du site</a></li></ul></footer>
     <script>let n=20;const p=document.getElementById("panel");p.addEventListener("scroll",()=>{if(n<50&&p.scrollTop+p.clientHeight>=p.scrollHeight-5){const from=n+1;n=Math.min(50,n+15);fetch("/more?from="+from+"&to="+n).then(r=>r.text()).then(h=>document.getElementById("feed").insertAdjacentHTML("beforeend",h));}});</script>`,
  ),
  // The same directory's second listing: cafés 41 to 50 again (now all with a phone) and 51 to 55.
  "/cafes2": page("Cafés à Alger, suite", `${NAV}<h1>Suite</h1><div>${range(41, 55).map((n) => card(n).replace("</h3>", `</h3><p>${phone(n)}</p>`)).join("")}</div>`),
  "/salons": page(
    "Salons",
    `${NAV}<table><thead><tr><th>Salon</th><th>Quartier</th><th>Téléphone</th></tr></thead><tbody>${range(1, 8).map((n) => `<tr><td>Salon Lina ${n}</td><td>Kouba</td><td>021 23 45 ${String(n).padStart(2, "0")}</td></tr>`).join("")}</tbody></table>`,
  ),
  "/article": page("Un article", `<h1>Les cafés d'Alger</h1><p>${"Un long texte sur les cafés de la ville, sans aucune liste. ".repeat(30)}</p>`),
};
http
  .createServer((req, res) => {
    const u = new URL(req.url, SITE);
    const body = u.pathname === "/more" ? range(Number(u.searchParams.get("from")), Number(u.searchParams.get("to"))).map((n) => card(n)).join("") : PAGES[u.pathname];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(body || "not found");
  })
  .listen(SITE_PORT, "127.0.0.1");

// ---- the scripted model ----
const live = () => ({ balance: 999, dailyUsed: 1, dailyLimit: 500, resetsAt: new Date(Date.now() + 864e5).toISOString(), credits: 1 });
const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: { subscribe: "", pricing: "", pilot: "", feedback: "" }, pilot: { open: false, eligible: false, status: null, credits: 0 } };
const reply = (content, stop) => ({ id: "msg_mock", type: "message", role: "assistant", model: "theOovi", content, stop_reason: stop, usage: { input_tokens: 100, output_tokens: 20 }, oovi: live() });
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const call = (name, input) => reply([{ type: "tool_use", id: `toolu_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, input }], "tool_use");
const systemOf = (b) => (typeof b.system === "string" ? b.system : Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("\n") : "");
const seen = { systems: {}, tools: {}, out: {} };

function answer(body) {
  const sys = systemOf(body);
  if (/learn from finished work/.test(sys)) return text('{"lessons":[],"user":[],"tools":[],"skill":null}');
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const out = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
  const prev = msgs[msgs.length - 2];
  const lastTool = results.length && prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
  const all = JSON.stringify(msgs);
  const scene = (all.match(/(LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT):(?![\s\S]*(?:LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT):)/) || [])[1] || "";
  const me = (sys.match(/You are (\w+)/) || [])[1] || "?";
  seen.systems[`${me}:${scene}`] = sys;
  seen.tools[me] = (body.tools || []).map((t) => t.name);
  if (lastTool) seen.out[`${me}:${scene}:${lastTool}`] = out;
  if (!scene) return text("ok");
  const done = () => text(`${scene}-RESULT: ${out.replace(/\s+/g, " ").slice(0, 500)}`);

  if (scene === "SHARE") {
    // The main bot hands the list to its group; the group's leader reads the table and adds to it.
    if (me === "Scout") {
      if (!lastTool) return call("message_group", { group: "Irkhasse", message: "SHARE: add one more café to the table Cafés Alger and tell me how many rows it has." });
      return done();
    }
    if (!lastTool) return call("work_table", { action: "read", table: "Cafés Alger", limit: 3 });
    if (lastTool === "work_table" && !/added/.test(out)) return call("work_table", { action: "add", table: "Cafés Alger", rows: [{ Name: "Café du groupe", Phone: "0550 99 99 99", Source: "https://groupe.example" }] });
    return done();
  }
  if (scene === "DIRECT") return lastTool ? done() : call("work_table", { action: "read", table: "Cafés Alger" });

  const url = { LIST: "/cafes", NEXT: "/cafes2", SCROLL: "/cafes", TABLE: "/salons", NOLIST: "/article" }[scene];
  if (!lastTool) return call("open_url", { url: SITE + url });
  if (lastTool === "open_url") {
    if (scene === "LIST") return call("extract_list", { table: "Cafés Alger", more: 6 });
    if (scene === "NEXT") return call("extract_list", { table: "cafés alger" });
    if (scene === "SCROLL") return call("scroll", { to: "bottom" });
    return call("extract_list", {});
  }
  return done();
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
      const refused = url === "/api/v1/ai/messages" && req.method === "POST" ? require("./model-rules.cjs").refusal(JSON.parse(raw)) : null;
      if (refused) return send(400, { error: refused });
      if (url === "/api/v1/ai/messages" && req.method === "POST") {
        try {
          return send(200, answer(JSON.parse(raw)));
        } catch (e) {
          return send(400, { error: String(e) });
        }
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
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  startServer();
  await waitReady();
  await api("POST", "/api/settings", { browser: { allowPrivateNetwork: true }, approvals: { clicksAndTyping: false } });
  const bots = await api("GET", "/api/bots");
  const scout = bots.find((b) => b.name === "Scout");
  const dm = `dm-${scout.id}`;
  async function run(chat, textIn) {
    await api("POST", `/api/chats/${chat}/run`, { text: textIn });
    for (let i = 0; i < 400; i++) {
      const c = await api("GET", `/api/chats/${chat}`);
      if (!c.running) return c;
      await sleep(300);
    }
    throw new Error("the run didn't end");
  }
  const lastText = (c) => c.entries.filter((e) => e.kind === "bot").at(-1)?.text ?? "";
  const work = (chat) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, "accounts", "p1test", "work", `${chat}.json`), "utf8"));
    } catch {
      return { tables: {}, notes: {} };
    }
  };
  const col = (t, name) => t.columns.indexOf(name);

  // A: the whole list, in one step.
  let c = await run(dm, "LIST: all the cafés of this directory, with their phone numbers");
  let t = work(dm).tables["Cafés Alger"];
  check("A) one extract_list call puts the whole list in the table: 50 cafés, loaded by scrolling its panel", !!t && t.rows.length === 50, t ? `${t.rows.length} rows; columns ${t.columns.join(", ")}` : lastText(c).slice(0, 300));
  if (t) {
    const names = t.rows.map((r) => r[0]);
    const phones = t.rows.map((r) => r[col(t, "Phone")]);
    check("A) the items are the cafés, not the page's menu or footer", names.every((n) => /^Café Numéro \d+$/.test(n)), names.filter((n) => !/^Café Numéro/.test(n)).slice(0, 3).join(" | "));
    check("A) phone numbers written as plain text and behind a 'call' link are both kept; an item without one stays empty", phones.filter(Boolean).length === 45 && phones[1] === "0550 10 00 02" && phones[0] === "+213550100001" && phones[9] === "", `${phones.filter(Boolean).length} with a phone; row 1 ${phones[0]}; row 2 ${phones[1]}; row 10 "${phones[9]}"`);
    check("A) each row has the business's own site and the page it was found on", t.rows[0][col(t, "Link")] === "https://cafe1.example/" && t.rows.every((r) => r[col(t, "Source")] === `${SITE}/cafes`), `${t.rows[0][col(t, "Link")]} | ${t.rows[0][col(t, "Source")]}`);
    check("A) opening hours and ratings are not taken for phone numbers", phones.every((p) => !p || /^(0550 10 00 \d\d|\+2135501000\d\d)$/.test(p)), phones.filter((p) => p && !/^(0550|\+213550)/.test(p)).slice(0, 3).join(" | "));
  }
  check("A) the bot is told the counts and shown a sample to check", /50 items in the list .*; 45 show a phone number/.test(seen.out["Scout:LIST:extract_list"] || "") && /50 added/.test(seen.out["Scout:LIST:extract_list"] || "") && /1\. Café Numéro 1 \|/.test(seen.out["Scout:LIST:extract_list"] || ""), (seen.out["Scout:LIST:extract_list"] || "").slice(0, 260));

  // B: a second listing completes, never repeats.
  c = await run(dm, "NEXT: the directory's next page too");
  t = work(dm).tables["Cafés Alger"];
  check("B) a second listing adds the new cafés and completes the known ones (same table, whatever the case of its name)", !!t && t.rows.length === 55 && t.rows[49][col(t, "Phone")] === "0550 10 00 50" && Object.keys(work(dm).tables).length === 1, t ? `${t.rows.length} rows; row 50 phone "${t.rows[49][col(t, "Phone")]}"; ${(seen.out["Scout:NEXT:extract_list"] || "").split("\n")[1]}` : "no table");

  // C: scroll.
  c = await run(dm, "SCROLL: show me what comes after the first cafés");
  check("C) scroll loads what comes next and shows the new text", /Scrolled bottom: \d+ more characters of text appeared/.test(seen.out["Scout:SCROLL:scroll"] || "") && /Café Numéro 21/.test(seen.out["Scout:SCROLL:scroll"] || "") && !/Café Numéro 1\n/.test((seen.out["Scout:SCROLL:scroll"] || "").split("PAGE TEXT")[1]?.split("INTERACTIVE")[0] || ""), (seen.out["Scout:SCROLL:scroll"] || "").slice(0, 200));

  // D: an HTML table; shown, not saved.
  c = await run(dm, "TABLE: what salons does this page list?");
  const shown = seen.out["Scout:TABLE:extract_list"] || "";
  check("D) the rows of an HTML table are a list too, with their numbers; without `table` nothing is saved", /8 items in the list/.test(shown) && /1\. Salon Lina 1 \| Kouba · 021 23 45 01 \| Phone: 021 23 45 01/.test(shown) && Object.keys(work(dm).tables).length === 1, shown.slice(0, 300));

  // E: no list.
  c = await run(dm, "NOLIST: take the list from this page");
  check("E) a page without a list says so and what to try next", /No list found on .*\/article\..*read_page.*containing.*selector/.test(seen.out["Scout:NOLIST:extract_list"] || ""), (seen.out["Scout:NOLIST:extract_list"] || "").slice(0, 200));

  // F: one job, one table.
  const newBot = (name) => api("POST", "/api/bots", { name, role: "", instructions: `You are ${name}, a teammate.`, face: scout.face, tools: { web: false, browser: false } });
  const amel = await newBot("Amel");
  const badr = await newBot("Badr");
  await api("PUT", "/api/main", { botId: scout.id });
  const group = await api("POST", "/api/chats", { name: "Irkhasse", memberIds: [amel.id, badr.id], leadId: amel.id });
  c = await run(dm, "SHARE: have the team add one more café to my list");
  for (let i = 0; i < 100 && (await api("GET", `/api/chats/${group.id}`)).running; i++) await sleep(300);
  t = work(dm).tables["Cafés Alger"];
  check("F) the group reads the main bot's table (it sees the 55 rows already found)", /"Cafés Alger": 55 rows/.test(seen.out["Amel:SHARE:work_table"] || "") || /55 rows/.test(JSON.stringify(seen.out)), (seen.out["Amel:SHARE:work_table"] || "").slice(0, 160));
  check("F) what the group adds lands in that same table: one table, one count", !!t && t.rows.length === 56 && t.rows[55][0] === "Café du groupe" && !Object.keys(work(group.id).tables).length, `${t?.rows.length} rows in the main chat; ${Object.keys(work(group.id).tables).length} tables in the group's own files`);
  check("F) the group's bots are told they work in the main assistant's files", /Work files \(the same ones as the main assistant who gave this task/.test(seen.systems["Amel:SHARE"] || ""));
  c = await run(group.id, "DIRECT: read the table Cafés Alger");
  check("F) a message written in the group itself uses the group's own files, as before", /There is no table "Cafés Alger"/.test(lastText(c)) && !/the same ones as the main assistant/.test(seen.systems["Amel:DIRECT"] || ""), lastText(c).slice(0, 160));

  // G: instructions.
  check("G) bots with a browser have scroll and extract_list; bots without don't", ["scroll", "extract_list"].every((n) => seen.tools.Scout.includes(n)) && !seen.tools.Amel.includes("extract_list"));
  check("G) every bot is told to keep a row found on a directory, with its source, marked to confirm", /a row needs a source, not a perfect one/.test(seen.systems["Amel:SHARE"] || "") && /never ask the user to copy from a page what a page shows/.test(seen.systems["Scout:LIST"] || ""));

  const ok = results.filter((x) => x.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
