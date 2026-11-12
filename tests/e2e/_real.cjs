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
//   G) bots are told to keep rows found on directories, with their source,
//   H) scrape_list does a whole site in one call, like a scraping script: every page of the list,
//      each item's own page for its phone number and address, the site's own footer number left out,
//   I) find_places answers from the open places data (a stand-in bucket and geocoders served here),
//   J) find_papers merges the open publication catalogues (stand-ins served here),
//   K) a phone number or an email is saved only when it was read somewhere in the chat,
//   L) forms: checkbox names, dropdown choices, a switched-off button, a dead address.
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DATA = path.join(os.tmpdir(), "oovi-real-test");
const PORT = 3325;
const MODEL_PORT = 3396;
const SITE_PORT = 3397;
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

const PARQUET = fs.readFileSync(path.join(__dirname, "fixtures", "places.parquet")); // 6,144 made-up places in three towns
const geo = { first: [], second: [] };
const papers = { crossref: [], epmc: [] };

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
  // "Annuaire": 3 pages of 12 salons (a "Suivant" link), each salon with its own page.
  ...Object.fromEntries(
    [1, 2, 3].map((p) => [
      p === 1 ? "/annuaire" : `/annuaire/p${p}`,
      page(
        `Salons, page ${p}`,
        `${NAV}<h1>Salons de beauté à Alger</h1><ul class="list">${range((p - 1) * 12 + 1, p * 12)
          .map((n) => `<li class="item"><a class="name" href="/salon/${n}">Salon Beauté ${n}</a><span class="area">Kouba</span><span class="price">${n}00 DA</span>${n % 6 === 0 ? `<span>0661 20 00 ${String(n).padStart(2, "0")}</span>` : ""}</li>`)
          .join("")}</ul><div class="pagination">${[1, 2, 3].map((x) => (x === p ? `<span class="active">${x}</span>` : `<a href="${x === 1 ? "/annuaire" : `/annuaire/p${x}`}">${x}</a>`)).join("")}${p < 3 ? `<a href="/annuaire/p${p + 1}">Suivant »</a>` : ""}</div>
         <footer>Annuaire Alger · Tél : 021 00 00 00 · <a href="mailto:contact@annuaire.example">contact</a></footer>`,
      ),
    ]),
  ),
  // The same kind of list where "next" is a button that swaps the items in place (no new address).
  "/app": page(
    "App",
    `<h1>Produits</h1><div id="list"></div><button id="nx" aria-label="Next page">›</button>
     <script>let p=1;const draw=()=>{document.getElementById("list").innerHTML=Array.from({length:10},(_,i)=>{const n=(p-1)*10+i+1;return '<div class="prod"><h3>Produit '+n+'</h3><p>Référence P-'+n+' en stock</p></div>'}).join("");if(p>=3)document.getElementById("nx").disabled=true;};draw();document.getElementById("nx").onclick=()=>{p++;draw();};</script>`,
  ),
  // A form like the owner's dashboard: a project to choose, a box to tick, a button that stays off until then.
  "/form": page(
    "Import",
    `<h1>Liste prospection</h1><label>Projet <select id="p" onchange="go()"><option value="">Choisir…</option><option value="1">m3ak (Alger)</option><option value="2">Autre projet</option></select></label>
     <div><input type="checkbox" id="c" onchange="go()"><label for="c">Projet prioritaire</label></div><div><input type="checkbox" id="d"><label for="d">Envoyer une copie</label></div>
     <button id="b" disabled onclick="document.getElementById('out').textContent='AJOUTÉ au projet '+document.getElementById('p').selectedOptions[0].text+(document.getElementById('c').checked?' (prioritaire)':'')">Ajouter</button><p id="out">rien</p>
     <script>function go(){document.getElementById("b").disabled=!document.getElementById("p").value;}</script>`,
  ),
  "/article": page("Un article", `<h1>Les cafés d'Alger</h1><p>${"Un long texte sur les cafés de la ville, sans aucune liste. ".repeat(30)}</p>`),
};
http
  .createServer((req, res) => {
    const u = new URL(req.url, SITE);
    // ---- stand-ins for the open places data (a bucket listing and one Parquet file) and the two geocoders ----
    if (u.pathname.startsWith("/bucket")) {
      const KEY = "release/2026-02-01.0/theme=places/type=place/part-00000.zstd.parquet";
      const prefix = u.searchParams.get("prefix");
      if (prefix === "release/") {
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(`<ListBucketResult><CommonPrefixes><Prefix>release/2026-01-01.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/2026-02-01.0/</Prefix></CommonPrefixes></ListBucketResult>`);
      }
      if (prefix) {
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(`<ListBucketResult>${prefix.startsWith("release/2026-02-01.0/") ? `<Contents><Key>${KEY}</Key><LastModified>x</LastModified><Size>${PARQUET.length}</Size></Contents>` : ""}</ListBucketResult>`);
      }
      if (decodeURIComponent(u.pathname) !== `/bucket/${KEY}`) {
        res.writeHead(404);
        return res.end();
      }
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const from = m ? Number(m[1]) : 0;
      const to = m && m[2] ? Math.min(Number(m[2]), PARQUET.length - 1) : PARQUET.length - 1;
      res.writeHead(m ? 206 : 200, { "content-type": "application/octet-stream", "accept-ranges": "bytes", "content-length": to - from + 1, ...(m ? { "content-range": `bytes ${from}-${to}/${PARQUET.length}` } : {}) });
      return res.end(PARQUET.subarray(from, to + 1));
    }
    // ---- stand-ins for the publication catalogues ----
    if (u.pathname === "/crossref/works") {
      papers.crossref.push(u.search);
      res.writeHead(200, { "content-type": "application/json" });
      const n = Math.min(40, Number(u.searchParams.get("rows")));
      return res.end(JSON.stringify({ message: { items: Array.from({ length: n }, (_, k) => ({ DOI: `10.5555/TEST.${k + 1}`, title: [`Study number ${k + 1} of membrane fouling in desalination`], author: [{ given: "Amel", family: `Author${k + 1}` }], issued: { "date-parts": [[2015 + (k % 10)]] }, "container-title": ["Journal of Tests"], type: "journal-article", "is-referenced-by-count": k * 3 })) } }));
    }
    if (u.pathname === "/epmc/search") {
      papers.epmc.push(u.searchParams.get("query"));
      res.writeHead(200, { "content-type": "application/json" });
      // Studies 1 to 20 again (with abstracts and free full text for the even ones), and 10 only found here.
      const rec = (k, extra = {}) => ({ id: `E${k}`, source: "MED", title: `Study number ${k} of membrane fouling in desalination.`, authorString: `Author${k} A.`, journalInfo: { journal: { title: "Journal of Tests" } }, pubYear: String(2015 + ((k - 1) % 10)), abstractText: `Abstract of study ${k}. 😀 Fouling was reduced.`, citedByCount: 1, isOpenAccess: "N", ...extra });
      const list = [...Array.from({ length: 20 }, (_, k) => rec(k + 1, { doi: `10.5555/test.${k + 1}`, ...((k + 1) % 2 === 0 ? { pmcid: `PMC${k + 1}`, isOpenAccess: "Y" } : {}) })), ...Array.from({ length: 10 }, (_, k) => rec(100 + k, { title: `Only in the medical catalogue ${k + 1}: biofilm on membranes.` }))];
      return res.end(JSON.stringify({ hitCount: list.length, nextCursorMark: "end", resultList: { result: list } }));
    }
    if (u.pathname === "/arxiv/api/query") {
      // As the real one does at times: it refuses to answer for a while.
      res.writeHead(429, { "content-type": "text/plain" });
      return res.end("Rate exceeded.");
    }
    if (u.pathname === "/geo/search") {
      geo.first.push(u.searchParams.get("q"));
      res.writeHead(200, { "content-type": "application/json" });
      // Only Testville is known here; a post office with the same name comes first, as in real answers.
      return res.end(JSON.stringify(/testville/i.test(u.searchParams.get("q")) ? [{ category: "amenity", display_name: "Poste de Testville", boundingbox: ["36.71", "36.7101", "3.01", "3.0101"] }, { category: "boundary", display_name: "Testville, Testland", boundingbox: ["36.69", "36.75", "2.99", "3.06"] }] : []));
    }
    if (u.pathname === "/geo2/api/") {
      geo.second.push(u.searchParams.get("q"));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ features: /farcity/i.test(u.searchParams.get("q")) ? [{ properties: { name: "Farcity", country: "Testland", extent: [9.99, 45.05, 10.06, 44.99] }, geometry: { coordinates: [10.02, 45.02] } }] : [] }));
    }
    const salon = u.pathname.match(/^\/salon\/(\d+)$/);
    // Salon 5's page is refused to plain downloads (as some sites do) and answers only a real browser.
    if (salon && salon[1] === "5" && !/Chrome\/\d+\.\d+\.\d+\.\d+/.test(req.headers["user-agent"] || "")) {
      res.writeHead(403, { "content-type": "text/html" });
      return res.end("Forbidden");
    }
    const body = salon
      ? page(`Salon Beauté ${salon[1]}`, `${NAV}<h1>Salon Beauté ${salon[1]}</h1><p>Coiffure et soins.</p>${salon[1] === "7" ? "" : `<a href="tel:+2135550000${String(salon[1]).padStart(2, "0")}">Appeler</a>`}<script type="application/ld+json">{"@type":"BeautySalon","address":"${salon[1]} rue des Roses, Kouba"}</script><footer>Annuaire Alger · Tél : 021 00 00 00 · <a href="mailto:contact@annuaire.example">contact</a></footer>`)
      : u.pathname === "/more" ? range(Number(u.searchParams.get("from")), Number(u.searchParams.get("to"))).map((n) => card(n)).join("") : PAGES[u.pathname];
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
let modelCalls = 0;
let T0 = Date.now();

function answer(body) {
  const sys = systemOf(body);
  if (/learn from finished work/.test(sys)) return text('{"lessons":[],"user":[],"tools":[],"skill":null}');
  modelCalls++;
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  const out = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
  const prev = msgs[msgs.length - 2];
  const lastTool = results.length && prev && Array.isArray(prev.content) ? (prev.content.find((b) => b.type === "tool_use") || {}).name : null;
  const all = JSON.stringify(msgs);
  const scene = (all.match(/(LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT|SITE|PATTERN|APP|PLACES|PAPERS|TRUTH|FORM):(?![\s\S]*(?:LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT|SITE|PATTERN|APP|PLACES|PAPERS|TRUTH|FORM):)/) || [])[1] || "";
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

  if (scene === "PLACES") {
    const steps = [
      { area: "Testville", categories: ["cafés"], table: "Lieux", limit: 700 },
      { area: "Farcity", categories: ["Beauty salons"], with_phone: true, limit: 5 },
      { area: "Testville", categories: ["plumber"] },
      { area: "Nowhere at all" },
      { area: "Testville", categories: ["cafe"], name: "testville 9", limit: 3 },
    ];
    const n = (all.split("PLACES:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`places${n}`] = out;
    return n < steps.length ? call("find_places", steps[n]) : text("PLACES-RESULT: done");
  }
  if (scene === "TRUTH") {
    // The bot reads a page with real numbers, then writes rows: some as read, some from "memory".
    const steps = [
      ["read_url", { url: `${SITE}/salons` }],
      // rows sent as JSON text, as models sometimes do
      ["work_table", { action: "add", table: "Vérifiés", columns: ["Nom", "Quartier", "Téléphone", "Email"], rows: JSON.stringify([["Salon Lina 1", "Kouba", "021 23 45 01", ""], ["Or noir", "Dely Brahim", "0561 06 30 53", "contact@ornoir.example"], ["Salon Lina 2", "Kouba", "+213 21 23 45 02 / 0555 43 21 09", ""]]) }],
      ["work_table", { action: "update", table: "vérifiés", row: 2, values: { "Téléphone": "0770 05 94 77", Quartier: "Chéraga" } }],
      ["work_table", { action: "update", table: "Vérifiés", row: 2, values: { "Téléphone": "021 23 45 03" } }],
      ["work_notes", { action: "write", file: "Étude de marché 2026", text: "Notes." }],
      ["work_notes", { action: "read", file: "etude de marche" }],
    ];
    const n = (all.split("TRUTH:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`truth${n}`] = out;
    return n < steps.length ? call(steps[n][0], steps[n][1]) : text("TRUTH-RESULT: done");
  }
  if (scene === "FORM") {
    const n = (all.split("FORM:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`form${n}`] = out;
    // The numbers come from the latest element list (a refused click returns none).
    if (/INTERACTIVE ELEMENTS/.test(out)) seen.formList = out;
    const num = (label) => Number(((seen.formList || "").match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`)) || [])[1]);
    if (n === 0) return call("open_url", { url: `${SITE}/form` });
    if (n === 1) return call("click", { element: num("Ajouter") }); // the button is switched off
    if (n === 2) return call("type", { element: num("select"), text: "Sport" }); // not a choice
    if (n === 3) return call("type", { element: num("select"), text: "m3ak" });
    if (n === 4) return call("click", { element: num("Projet prioritaire") });
    if (n === 5) return call("click", { element: num("Ajouter") });
    if (n === 6) return call("open_url", { url: "http://this-name-does-not-exist-oovi-test.invalid/saas" });
    return text("FORM-RESULT: done");
  }
  if (scene === "PAPERS") {
    const steps = [
      { query: "membrane fouling desalination", year_from: 2016, limit: 40, table: "Littérature" },
      { query: "membrane fouling desalination", sort: "most_cited", limit: 3 },
      { query: "membrane fouling desalination", free_full_text: true, limit: 50 },
    ];
    const n = (all.split("PAPERS:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`papers${n}`] = out;
    return n < steps.length ? call("find_papers", steps[n]) : text("PAPERS-RESULT: done");
  }
  // One call each: the engine does the pages by itself.
  if (scene === "SITE") { const steps = JSON.parse(process.env.REAL_STEPS); const n = (all.match(/"type":"tool_use"/g) || []).length; if (lastTool) console.log("STEP", n, "ms", Date.now() - T0, "\n" + out.slice(0, Number(process.env.REAL_CHARS || 2200))); return n < steps.length ? call(steps[n][0], steps[n][1]) : text("SITE-RESULT: done"); }
  if (scene === "PATTERN") return lastTool ? done() : call("scrape_list", { url: `${SITE}/annuaire/p{page}`, from_page: 2, pages: 2, table: "Pages 2 et 3" });
  if (scene === "APP") return lastTool ? done() : call("scrape_list", { url: `${SITE}/app`, table: "Produits", pages: 5 });

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

  T0 = Date.now();
  await run(dm, "SITE: go");
  for (const [name, t] of Object.entries(work(dm).tables)) { console.log("TABLE", name, "rows", t.rows.length, "|", t.columns.join(" | ")); for (const r of t.rows.slice(0, 50)) console.log(" ", r.map((c) => c.slice(0, 40)).join(" | ")); }
  const ok = results.filter((x) => x.ok).length;
  log(`${ok}/${results.length} checks passed`);
  server.kill();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => {
  log("ERROR", e.stack || String(e));
  server?.kill();
  process.exit(2);
});
