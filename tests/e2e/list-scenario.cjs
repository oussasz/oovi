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
  const scene = (all.match(/(LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT|SITE|PATTERN|APP|PLACES|PAPERS|TRUTH|FORM|HINT|PLAN):(?![\s\S]*(?:LIST|NEXT|SCROLL|TABLE|NOLIST|SHARE|DIRECT|SITE|PATTERN|APP|PLACES|PAPERS|TRUTH|FORM|HINT|PLAN):)/) || [])[1] || "";
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
      { area: "Testville", categories: ["server answer"], limit: 5 },
    ];
    const n = (all.split("PLACES:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`places${n}`] = out;
    return n < steps.length ? call("find_places", steps[n]) : text("PLACES-RESULT: done");
  }
  if (scene === "PLAN") {
    seen.planSys = sys;
    seen.planTools = (body.tools || []).map((t) => t.name);
    const n = (all.split("PLAN:").pop().match(/"type":"tool_use"/g) || []).length;
    if (lastTool) seen.out[`plan${n}`] = out;
    if (/INTERACTIVE ELEMENTS/.test(out)) seen.planList = out;
    const num = (label) => Number(((seen.planList || "").match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`)) || [])[1]);
    if (n === 0) return call("propose_plan", { goal: "Add the list to the m3ak project", steps: ["Open the import page", "Choose the m3ak project", "Tick Projet prioritaire", "Click Ajouter"] });
    if (n === 1) return call("open_url", { url: `${SITE}/form` });
    if (n === 2) return call("type", { element: num("select"), text: "m3ak" });
    if (n === 3) return call("click", { element: num("Projet prioritaire") });
    if (n === 4) return call("click", { element: num("Ajouter") });
    return text(`PLAN-RESULT: ${((out.match(/AJOUTÉ[^\n]*/) || [""])[0])}`);
  }
  if (scene === "HINT") {
    if (lastTool) seen.out[`hint:${me}`] = out;
    return lastTool ? text("HINT-RESULT: read") : call("read_url", { url: `${SITE}/annuaire` });
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
  if (scene === "SITE") return lastTool ? done() : call("scrape_list", { url: `${SITE}/annuaire`, table: "Salons Alger", pages: 10, details: true, fields: { Prix: ".price" } });
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
      // The oovi server's find_places: answers only the "server answer" question (else as an older server would: 404).
      if (url === "/api/v1/places" && req.method === "POST") {
        const q = JSON.parse(raw);
        seen.placesServer = q;
        if (!(q.words || []).includes("server answer")) return send(404, { error: "not found" });
        return send(200, { release: "server-test", skipped: 0, matching: 1, open: 9, top: [], hits: [{ names: { primary: "Café du serveur" }, basic_category: "cafe", phones: ["+213550999999"], addresses: [{ freeform: "1 rue du Serveur", locality: "Testville" }], confidence: 0.9 }] });
      }
      const refused = url === "/api/v1/ai/messages" && req.method === "POST" ? require("./model-rules.cjs").refusal(JSON.parse(raw)) : null;
      if (refused) return send(400, { error: refused });
      if (url === "/api/v1/ai/messages" && req.method === "POST" && require("./model-rules.cjs").isDoneCheck(JSON.parse(raw))) return send(200, require("./model-rules.cjs").doneReply(JSON.parse(raw)));
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
    env: { ...process.env, OOVI_CROSSREF_URL: `${SITE}/crossref`, OOVI_EUROPEPMC_URL: `${SITE}/epmc`, OOVI_ARXIV_URL: `${SITE}/arxiv`, OOVI_PLACES_URL: `${SITE}/bucket`, OOVI_GEOCODER_URL: `${SITE}/geo`, OOVI_GEOCODER2_URL: `${SITE}/geo2`, OOVI_TEST_DATA: DATA, OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: `http://127.0.0.1:${MODEL_PORT}`, PORT: String(PORT) },
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

  // H: a whole site in one call, like a scraping script.
  const before = modelCalls;
  c = await run(dm, "SITE: all the beauty salons of this directory with their phone numbers");
  const used = modelCalls - before;
  t = work(dm).tables["Salons Alger"];
  const res = seen.out["Scout:SITE:scrape_list"] || "";
  check("H) one scrape_list call goes through all 3 pages by itself (it follows 'Suivant' and stops at the end): 36 salons", !!t && t.rows.length === 36 && /36 items from 3 pages/.test(res), `${t?.rows.length} rows | ${res.split("\n").slice(0, 4).join(" / ").slice(0, 330)}`);
  check("H) the whole job cost 2 model calls (the call and the answer), not one per page or per salon", used === 2, `${used} model calls`);
  if (t) {
    const ph = t.rows.map((r) => r[col(t, "Phone")]);
    check("H) each salon's own page was opened for its phone number: 35 of 36 (salon 7 shows none)", ph.filter(Boolean).length === 35 && ph[0] === "+213555000001" && ph[5] === "0661 20 00 06" && ph[6] === "", `${ph.filter(Boolean).length} phones; salon 1 ${ph[0]}; salon 6 ${ph[5]}; salon 7 "${ph[6]}"`);
    check("H) a page that refuses plain downloads is read in the browser instead (salon 5)", ph[4] === "+213555000005", `salon 5: "${ph[4]}"`);
    check("H) the directory's own number and email (in every footer) are given to no salon", !ph.some((p) => /021 00 00 00/.test(p)) && (col(t, "Email") < 0 || t.rows.every((r) => !r[col(t, "Email")])), `columns ${t.columns.join(", ")}`);
    check("H) the address from each salon's page and the asked-for column (Prix) are in the table", t.rows[0][col(t, "Address")] === "1 rue des Roses, Kouba" && t.rows[11][col(t, "Prix")] === "1200 DA", `${t.rows[0][col(t, "Address")]} | ${t.rows[11][col(t, "Prix")]}`);
  }
  if (t) check("H) each row names the page it was found on", t.rows[0][col(t, "Source")] === `${SITE}/annuaire` && t.rows[35][col(t, "Source")] === `${SITE}/annuaire/p3`, `${t.rows[0][col(t, "Source")]} | ${t.rows[35][col(t, "Source")]}`);
  c = await run(dm, "PATTERN: pages 2 and 3 only");
  t = work(dm).tables["Pages 2 et 3"];
  check("H) a URL with {page} reads exactly the pages asked (2 and 3: salons 13 to 36)", !!t && t.rows.length === 24 && t.rows[0][0] === "Salon Beauté 13", `${t?.rows.length} rows, first ${t?.rows[0]?.[0]}`);
  c = await run(dm, "APP: all the products");
  t = work(dm).tables["Produits"];
  check("H) a 'next' button that changes the list in place is clicked until it is disabled: 30 products from 3 pages", !!t && t.rows.length === 30 && /30 items from 3 pages/.test(seen.out["Scout:APP:scrape_list"] || ""), `${t?.rows.length} rows | ${(seen.out["Scout:APP:scrape_list"] || "").split("\n").slice(0, 4).join(" / ").slice(0, 300)}`);

  // I: businesses of an area from the open places data, without visiting a website.
  c = await run(dm, "PLACES: the cafés of Testville, then other questions");
  t = work(dm).tables["Lieux"];
  const p1 = seen.out.places1 || "";
  check("I) find_places gives every café of the area in one call, from the open data: 669, none of them closed", /669 places in Testville, Testland \(about [\d.]+ × [\d.]+ km\) in the categories cafe; 498 of 669 have a phone number/.test(p1) && !!t && t.rows.length === 669, `${t?.rows.length} rows | ${p1.split("\n")[0].slice(0, 200)}`);
  if (t) {
    const row = (name) => t.rows.find((r) => r[0] === name) || [];
    check("I) the district is chosen over a shop of the same name, and only that area's places come back", t.rows.every((r) => /^Café Testville \d+$/.test(r[0])), t.rows.filter((r) => !/^Café Testville/.test(r[0])).slice(0, 2).join(" | "));
    check("I) rows carry phone, address, email, website or social page, and the source", row("Café Testville 9")[col(t, "Phone")] === "+213550000009" && row("Café Testville 9")[col(t, "Address")] === "10 rue des Tests, Testville, 16000" && row("Café Testville 105")[col(t, "Link")] === "https://site105.example/" && row("Café Testville 105")[col(t, "Email")] === "contact105@example.test" && /Overture Maps open data \(2026-02-01\.0\)/.test(row("Café Testville 9")[col(t, "Source")]), `${row("Café Testville 9").join(" | ").slice(0, 160)} || ${row("Café Testville 105").join(" | ").slice(0, 160)}`);
    check("I) a placeholder link in the data is not kept as a website (the social page is)", row("Café Testville 33")[col(t, "Link")] === "https://www.facebook.com/100033", row("Café Testville 33")[col(t, "Link")]);
    check("I) the best-known places come first", t.rows[0][0] === "Café Testville 9", t.rows[0][0]);
  }
  check("I) the bot is told where the data comes from and to treat numbers as 'to confirm'", /Source: Overture Maps open data .*Treat numbers as "to confirm"/.test(p1));
  const p2 = seen.out.places2 || "";
  check("I) when the first geocoder doesn't know a place, the second one is asked (Farcity)", /places in Farcity, Testland/.test(p2) && geo.second.some((q) => /Farcity/.test(q)) && /the 5 best-known are given/.test(p2) && (p2.match(/Phone: \+2135500/g) || []).length === 5 && /beauty salon/.test(p2), p2.split("\n")[0].slice(0, 200));
  check("I) a category that matches nothing gets the area's own categories to choose from", /Nothing in Testville.* matches the categories plumber\. The data has 2007 places there.*beauty_salon \(670\), cafe \(669\)/.test(seen.out.places3 || ""), (seen.out.places3 || "").slice(0, 220));
  check("I) a place that isn't on the map says so and what to write", /"Nowhere at all" wasn't found on the map/.test(seen.out.places4 || ""), (seen.out.places4 || "").slice(0, 120));
  check("I) a name filter narrows the answer", /Café Testville 9\b/.test(seen.out.places5 || "") && !/Café Testville 39/.test(seen.out.places5 || ""), (seen.out.places5 || "").split("\n").slice(2, 4).join(" / ").slice(0, 200));
  check("I) when the oovi server answers, its answer is used (the area located here, the question sent with it)", /Café du serveur \| cafe \| 1 rue du Serveur, Testville \| Phone: \+213550999999/.test(seen.out.places6 || "") && /Overture Maps open data \(server-test\)/.test(seen.out.places6 || "") && seen.placesServer?.box?.xmin < 3.0 && seen.placesServer?.limit === 5, (seen.out.places6 || "").slice(0, 200));
  check("I) the data's index is kept on disk, so the next question doesn't rebuild it", fs.existsSync(path.join(DATA, "accounts", "p1test", "cache", "places", "2026-02-01.0.json")) || fs.existsSync(path.join(DATA, "cache", "places", "2026-02-01.0.json")));

  // J: scientific publications from the open catalogues, merged, in one call.
  c = await run(dm, "PAPERS: what has been published on membrane fouling in desalination since 2016?");
  t = work(dm).tables["Littérature"];
  const j1 = seen.out.papers1 || "";
  check("J) find_papers asks the catalogues once each and saves the merged list: 40 publications from 2016 on", !!t && t.rows.length === 40 && /40 publications for "membrane fouling desalination", 2016–…, most relevant first/.test(j1), `${t?.rows.length} rows | ${j1.split("\n")[0].slice(0, 230)}`);
  check("J) the year filter is sent to the catalogues, and the product names itself to them (never the user)", papers.crossref.some((q) => /from-pub-date(:|%3A)2016/.test(q) && /mailto=contact(@|%40)conuron\.com/.test(q)) && papers.epmc.some((q) => /PUB_YEAR:\[2016 TO 3000\]/.test(q)), `${papers.crossref[0]} | ${papers.epmc[0]}`);
  if (t) {
    const two = t.rows.find((r) => r[0] === "Study number 2 of membrane fouling in desalination") || [];
    check("J) a paper found in two catalogues is one row with the best of both: citations from one, abstract and free full text from the other", two[col(t, "Source")] === "Crossref + Europe PMC" && two[col(t, "Citations")] === "3" && /Abstract of study 2\./.test(two[col(t, "Abstract")] || "") && two[col(t, "Free full text")] === "https://europepmc.org/article/PMC/PMC2" && t.rows.filter((r) => /^Study number 2 of/.test(r[0])).length === 1, two.map((x) => x.slice(0, 40)).join(" | "));
    check("J) papers before 2016 are left out; DOI and link are in the table", t.rows.every((r) => Number(r[col(t, "Year")]) >= 2016) && two[col(t, "DOI")] === "10.5555/test.2" && two[col(t, "Link")] === "https://doi.org/10.5555/test.2", `${two[col(t, "DOI")]} | ${two[col(t, "Link")]}`);
  }
  check("J) a catalogue that doesn't answer (arXiv, limiting requests) is named, and the others still answer", /arXiv couldn't be read \(it is limiting how often it can be asked right now\): the answer comes from the others/.test(j1), j1.split("\n")[1]?.slice(0, 160));
  check("J) the bot is told a record is not the paper: read it before reporting its findings", /A record proves the paper exists, not what it shows/.test(j1));
  check("J) 'most cited' sorts the relevant results", /^1\. Study number 40 of[^\n]*cited 117/m.test(seen.out.papers2 || ""), (seen.out.papers2 || "").split("\n").slice(3, 4).join("").slice(0, 160));
  check("J) 'free full text only' keeps only papers with a free link (the 10 even-numbered ones)", /^10 publications/.test(seen.out.papers3 || "") && /10 have a free full text link/.test(seen.out.papers3 || ""), (seen.out.papers3 || "").split("\n")[0].slice(0, 200));

  // N: a bot acting with the user's accounts proposes one plan; once approved, its clicks and typing don't ask again.
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: true } });
  const agent = await api("POST", "/api/bots", { name: "Agent", role: "", instructions: "You are Agent, an assistant.", face: scout.face, tools: { web: true, browser: true, accounts: true } });
  const ach = `dm-${agent.id}`;
  await api("POST", `/api/chats/${ach}/run`, { text: "PLAN: add my list to the m3ak project on the dashboard" });
  let pc = null;
  for (let i = 0; i < 100; i++) {
    pc = await api("GET", `/api/chats/${ach}`);
    if (!pc.running) break;
    await sleep(300);
  }
  check("N) a bot that acts with the user's accounts is told to propose one plan first, and has the tool for it", (seen.planTools || []).includes("propose_plan") && /call propose_plan once with the whole task/.test(seen.planSys || ""));
  check("N) the plan waits for the user's OK before anything is done", !!pc?.pending?.planReview && !seen.out.plan1, JSON.stringify(pc?.pending || {}).slice(0, 120));
  const cards = [];
  await api("POST", `/api/chats/${ach}/run`, { planDecision: { approve: true, items: ["Open the import page", "Choose the m3ak project", "Tick Projet prioritaire", "Click Ajouter"] } });
  for (let i = 0; i < 100; i++) {
    pc = await api("GET", `/api/chats/${ach}`);
    if (!pc.running) {
      if (!pc.pending?.approval) break;
      cards.push(pc.pending.approval.items.map((x) => x.summary).join(" + "));
      await api("POST", `/api/chats/${ach}/run`, { decisions: Object.fromEntries(pc.pending.approval.items.map((x) => [x.call.id, true])) });
    }
    await sleep(300);
  }
  const lastPlan = pc.entries.filter((e) => e.kind === "bot").at(-1)?.text ?? "";
  check("N) after the one approval, every click and typing runs without another card, and the job gets done", cards.length === 0 && /PLAN-RESULT: AJOUTÉ au projet m3ak \(Alger\) \(prioritaire\)/.test(lastPlan), `${cards.length} cards: ${cards.join(" | ").slice(0, 160)} || ${lastPlan.slice(0, 120)}`);
  await api("POST", "/api/settings", { approvals: { clicksAndTyping: false } });

  // M: a page that is a list says so where the bot reads it, and every bot that can search can collect it.
  const webby = await api("POST", "/api/bots", { name: "Webby", role: "", instructions: "You are Webby, a researcher.", face: scout.face, tools: { web: true, browser: false } });
  await run(`dm-${webby.id}`, "HINT: what is on this directory page?");
  const hint = seen.out["hint:Webby"] || "";
  check("M) reading a directory page tells the bot it is a list and gives the exact scrape_list call", /This page is a list of about 12 items \(2 show a phone number\), and it has more pages\. To keep them all, call scrape_list with url="http:\/\/127\.0\.0\.1:\d+\/annuaire"/.test(hint), hint.split("This page is a list")[1]?.slice(0, 200) || hint.slice(-200));
  check("M) a bot with web search but no browser has scrape_list (collecting public pages is reading)", (seen.tools.Webby || []).includes("scrape_list") && !(seen.tools.Webby || []).includes("click"), (seen.tools.Webby || []).join(","));

  // K: a phone number or an email is saved only when it was read somewhere.
  c = await run(dm, "TRUTH: make me a verified list from this page");
  t = work(dm).tables["Vérifiés"];
  const k2 = seen.out.truth2 || "";
  check("K) rows sent as JSON text are read as the list they are (3 rows added)", !!t && t.rows.length === 3 && /3 added/.test(k2), `${t?.rows.length} rows | ${k2.split("\n")[0].slice(0, 120)}`);
  if (t) {
    const tel = col(t, "Téléphone");
    check("K) a number read on the page is saved; one that was read nowhere is left out, and the row is kept", t.rows[0][tel] === "021 23 45 01" && t.rows[1][0] === "Or noir" && t.rows[1][col(t, "Email")] === "" && t.rows[2][tel] === "+213 21 23 45 02", `${t.rows[0][tel]} | Or noir: "${t.rows[1][tel]}" "${t.rows[1][col(t, "Email")]}" | ${t.rows[2][tel]}`);
    check("K) the bot is told exactly what was not saved and what to do", /NOT SAVED: 0561 06 30 53 \(Téléphone of "Or noir"\); contact@ornoir\.example \(Email of "Or noir"\); 0555 43 21 09 \(Téléphone of "Salon Lina 2"\)\. These values appear in nothing read in this chat/.test(k2), k2.split("\n")[1]?.slice(0, 220));
    check("K) the same holds for an update: the invented number is refused, the rest of the update is saved; a number from the page is accepted", /NOT SAVED: 0770 05 94 77/.test(seen.out.truth3 || "") && t.rows[1][col(t, "Quartier")] === "Chéraga" && t.rows[1][tel] === "021 23 45 03" && !/NOT SAVED/.test(seen.out.truth4 || ""), `${t.rows[1].join(" | ")}`);
  }
  check("K) a work file asked for by an approximate name is found when only one fits", /notes "Étude de marché 2026"/.test(seen.out.truth6 || ""), (seen.out.truth6 || "").slice(0, 100));

  // L: forms. A box is named by the words beside it, a dropdown shows its choices, a switched-off button says why.
  c = await run(dm, "FORM: add the list to the m3ak project");
  const f1 = seen.out.form1 || "";
  check("L) the bot sees what a dropdown offers, which boxes are ticked and that the button is switched off", /select "Projet[^"]*" \(chosen: Choisir…; choices: Choisir… \| m3ak \(Alger\) \| Autre projet\)/.test(f1) && /input:checkbox "Projet prioritaire" \(not ticked\)/.test(f1) && /button "Ajouter" \(switched off\)/.test(f1), f1.split("INTERACTIVE")[1]?.replace(/\n/g, " / ").slice(0, 330));
  check("L) clicking a switched-off button explains what the page is waiting for (no 10-second timeout)", /is switched off: the page is waiting for something first/.test(seen.out.form2 || ""), (seen.out.form2 || "").slice(0, 120));
  check("L) a choice the dropdown doesn't have is refused with the real choices", /has no choice "Sport"\. Its choices: Choisir… \| m3ak \(Alger\) \| Autre projet/.test(seen.out.form3 || ""), (seen.out.form3 || "").slice(0, 140));
  check("L) the bot chooses in the dropdown, ticks the box and the page's own button then works", /Chose "m3ak \(Alger\)" in the dropdown/.test(seen.out.form4 || "") && /"Projet prioritaire" \(ticked\)/.test(seen.out.form5 || "") && /AJOUTÉ au projet m3ak \(Alger\) \(prioritaire\)/.test(seen.out.form6 || ""), `${(seen.out.form4 || "").slice(0, 50)} | ${((seen.out.form6 || "").match(/AJOUTÉ[^\n]*/) || [""])[0]}`);
  check("L) an address that no longer exists is explained in plain words (a tunnel address changes)", /No website answers at this address: the name doesn't exist/.test(seen.out.form7 || ""), (seen.out.form7 || "").slice(0, 140));

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
  check("G) bots with a browser have scroll, extract_list and scrape_list; bots without don't", ["scroll", "extract_list", "scrape_list", "find_places", "find_papers"].every((n) => seen.tools.Scout.includes(n)) && !seen.tools.Amel.includes("extract_list"));
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
