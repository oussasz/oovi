// Real-model evals: the tasks that failed for real users, run on the hosted model and graded on what
// actually happened (who got an email, how many cards, questions, model calls and credits), never on what a
// prompt says. The other scenarios in tests/e2e use a scripted stand-in model: they prove the plumbing, not
// that a bot does the job. A change to the harness isn't done until these pass.
//
//   node tests/evals/run.cjs                 every scenario
//   node tests/evals/run.cjs bulk-all        one or more by id
//   node tests/evals/run.cjs --list          their ids and titles
// Two families: acting through a connector (emails to a list, connecting an app) and work that needs none
// (answers, research, files read and made, lists, routines). A scenario is graded by its own `grade`.
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

const ExcelJS = require(path.join(ROOT, "node_modules/exceljs"));
const JSZip = require(path.join(ROOT, "node_modules/jszip"));

/** Every file under a folder (what a run delivered). */
function filesIn(dir) {
  const out = [];
  const walk = (d) => { for (const f of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else out.push({ name: f.name, path: p, ext: path.extname(f.name).slice(1).toLowerCase(), size: fs.statSync(p).size }); } };
  walk(dir);
  return out;
}
/** A workbook as plain rows per sheet: a formula cell gives {f: "A1*B1", v: its saved result or null}. */
async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map((v) => (v && typeof v === "object" && "formula" in v ? { f: String(v.formula), v: v.result ?? null } : v && typeof v === "object" && "richText" in v ? v.richText.map((x) => x.text).join("") : v && typeof v === "object" && "text" in v ? v.text : v ?? ""))));
    return { name: ws.name, rows, charts: (ws.model && ws.model.drawing ? 1 : 0) };
  });
}
const plain = (c) => (c && typeof c === "object" ? (c.v ?? `=${c.f}`) : c);
const cellsOf = (sheets) => sheets.flatMap((s) => s.rows.flat().map(plain).map((x) => String(x)));
/** The words of a Word or PowerPoint file (and how many slides). */
async function readOffice(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml)$/.test(n));
  let text = "";
  for (const n of names) text += (await zip.files[n].async("string")).replace(/<\/(w:p|a:p)>/g, "\n").replace(/<[^>]+>/g, "") + "\n";
  return { text, slides: names.filter((n) => n.startsWith("ppt/")).length, charts: Object.keys(zip.files).filter((n) => /charts?\/chart\d*\.xml$/.test(n)).length };
}
/** Fixtures made for one run. */
async function makeProducts(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Produits");
  ws.addRow(["Produit", "Prix", "Quantité"]);
  for (const r of PRODUCTS) ws.addRow(r);
  await wb.xlsx.writeFile(file);
}
const PRODUCTS = [["Chaise", 4500, 12], ["Table", 18000, 3], ["Lampe", 2300, 20], ["Bureau", 26000, 2], ["Étagère", 7400, 5], ["Tapis", 9900, 4], ["Miroir", 5600, 6], ["Canapé", 64000, 1]];
const PRODUCTS_TOTAL = PRODUCTS.reduce((a, r) => a + r[1] * r[2], 0);
async function makeReport(file) {
  const { Document, Packer, Paragraph, HeadingLevel } = require(path.join(ROOT, "node_modules/docx"));
  const filler = "Cette section décrit le contexte général de l'activité, les équipes concernées et la méthode de suivi utilisée pendant l'année. Les indicateurs sont relevés chaque mois et discutés en comité de direction, puis consolidés par trimestre.";
  const paras = [
    ["Rapport annuel 2025 de Dar El Bahdja Distribution", HeadingLevel.TITLE],
    ["1. Résultats", HeadingLevel.HEADING_1], [filler], ["Le chiffre d'affaires 2025 atteint 4,2 millions de dinars, en hausse de 18 % par rapport à 2024."], [filler],
    ["2. Réseau", HeadingLevel.HEADING_1], [filler], ["Trois nouveaux magasins ont ouvert à Sétif au second semestre."], [filler],
    ["3. Équipe", HeadingLevel.HEADING_1], [filler], ["L'entreprise a recruté 12 personnes, dont 5 commerciaux."], [filler],
    ["4. Projets", HeadingLevel.HEADING_1], [filler], ["Le lancement de l'application mobile est prévu pour mars 2026."], [filler],
    ["5. Risques", HeadingLevel.HEADING_1], [filler], ["Le principal risque identifié est le retard de livraison du fournisseur de Blida."], [filler],
  ].map(([text, heading]) => new Paragraph({ text, ...(heading ? { heading } : {}) }));
  fs.writeFileSync(file, await Packer.toBuffer(new Document({ sections: [{ children: paras }] })));
}

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
    user("u0002", "دير ستوري انستغرام على مشروع m3ak", 30),
    bot("b0002", "واش تحب نكتب في الستوري؟ أعطيني النقاط الأساسية وأنا نكتبها.", 30),
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
      "- Instagram story about the m3ak project: waiting for the user's key points.",
      "- No clear instruction was given for the YouTube channel.",
    ].join("\n"),
  };
  // A job that stopped before its goal an hour ago (the Stop button, a target not reached): for a day, the
  // released version read ANY next message as "go on with it".
  const openJob = { goal: "Collect 50 YouTube cooking channels with their subscriber counts", by: botId, table: "YouTube channels", target: 50, at: Date.now() - 3600_000 };
  return { entries, summary, openJob };
}

// (Nothing here may also be a word of the leads workbook: "Facebook" is in its notes column.)
const OLD_TOPICS = /youtube|يوتوب|يوتيوب|instagram|انستغرام|إنستغرام|m3ak|أغنية|اغنية|chanson|song|طوكيو|tokyo|cooking|طبخ/i;

const SCENARIOS = [
  {
    id: "bulk-all",
    saidEveryone: true,
    title: "1,001-line workbook: \"send an email to everyone in the list\"",
    zapier: { enabled: true, connected: true },
    steps: [{ say: "ابعث إيمايل لكل واحد في القائمة", file: LEADS }],
    expected: () => ROWS.filter((r) => r.email).map((r) => r.email),
    limits: { cards: 1, questions: 1, calls: 10, credits: 12 },
  },
  {
    id: "bulk-all-refused",
    saidEveryone: true,
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
    saidEveryone: true,
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
  // ---------- work that needs no connector ----------
  {
    id: "quick-answer",
    title: "a plain question: the answer at once, no tools",
    steps: [{ say: "شحال تجي 15% من 2400؟" }],
    grade: async (c) => [
      ["the answer is 360", /360/.test(c.last)],
      [`no tool was needed (${c.tools.join(", ") || "none"})`, c.tools.length === 0],
      [`a short answer (${c.last.length} characters)`, c.last.length < 400],
    ],
    limits: { cards: 0, questions: 0, calls: 1, credits: 5 },
  },
  {
    id: "table-question",
    title: "a question about a 1,001-line workbook that needs counting per group",
    steps: [{ say: "أي مدينة فيها أكبر عدد من الزبائن في هذي القائمة، وشحال عددهم؟ وشحال من واحد في Oran عندو إيمايل؟", file: LEADS }],
    grade: async (c) => {
      const by = {};
      for (const r of ROWS) by[r.city] = (by[r.city] || 0) + 1;
      const [top, n] = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
      const oran = ROWS.filter((r) => r.city === "Oran" && r.email).length;
      return [
        [`names the city with the most rows (${top}, ${n})`, /constantine|قسنطينة/i.test(c.last) && new RegExp(`\\b${n}\\b`).test(c.last)],
        [`counts Oran's rows with an email (${oran})`, new RegExp(`\\b${oran}\\b`).test(c.last)],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 5, credits: 8 },
  },
  {
    id: "table-export",
    title: "a part of a workbook delivered as a new Excel file, complete and exact",
    steps: [{ say: "اعطيني ملف Excel جديد فيه غير الزبائن اللي في Oran وعندهم إيمايل", file: LEADS }],
    grade: async (c) => {
      const want = new Set(ROWS.filter((r) => r.city === "Oran" && r.email).map((r) => r.email.toLowerCase()));
      const x = c.files.find((f) => f.ext === "xlsx" || f.ext === "csv");
      if (!x) return [["an Excel or CSV file was delivered", false]];
      const cells = x.ext === "xlsx" ? cellsOf(await c.readXlsx(x.path)) : fs.readFileSync(x.path, "utf8").split(/[,;\n\r]+/);
      const got = new Set(cells.map((v) => v.trim().toLowerCase()).filter((v) => /^[^@\s]+@[^@\s]+$/.test(v)));
      return [
        [`an Excel or CSV file was delivered (${x.name})`, true],
        [`it holds every wanted row (${[...want].filter((e) => got.has(e)).length} of ${want.size})`, [...want].every((e) => got.has(e))],
        [`and no other address (${[...got].filter((e) => !want.has(e)).length})`, [...got].every((e) => want.has(e))],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 6, credits: 10 },
  },
  {
    id: "table-chart",
    title: "a chart from a workbook's column",
    steps: [{ say: "ديرلي ملف Excel فيه رسم بياني لعدد الزبائن حسب Statut من هذي القائمة", file: LEADS }],
    grade: async (c) => {
      const by = {};
      for (const r of ROWS) by[r.status] = (by[r.status] || 0) + 1;
      const x = c.files.find((f) => f.ext === "xlsx");
      if (!x) return [["an Excel file was delivered", false]];
      const cells = cellsOf(await c.readXlsx(x.path));
      const right = Object.entries(by).filter(([st, n]) => cells.includes(st) && cells.includes(String(n))).length;
      const zip = await JSZip.loadAsync(fs.readFileSync(x.path));
      const charts = Object.keys(zip.files).filter((n) => /xl\/charts\/chart\d+\.xml$/.test(n)).length;
      return [
        [`an Excel file was delivered (${x.name})`, true],
        [`with the right count for every status (${right} of ${Object.keys(by).length})`, right === Object.keys(by).length],
        [`and a real chart in it (${charts})`, charts >= 1],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 6, credits: 10 },
  },
  {
    id: "file-edit",
    title: "a small workbook edited: a computed column and a total",
    steps: [{ say: "زيد عمود Total (Prix × Quantité) وسطر فيه المجموع الكلي، واعطيني الملف", make: async (dir) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, "Produits.xlsx"); await makeProducts(f); return f; } }],
    grade: async (c) => {
      const x = c.files.find((f) => f.ext === "xlsx");
      if (!x) return [["an Excel file was delivered", false]];
      const sheets = await c.readXlsx(x.path);
      const rows = sheets[0].rows;
      const head = rows[0].map((h) => String(plain(h)).toLowerCase());
      const col = head.findIndex((h) => /total|مجموع/.test(h));
      const first = col >= 0 ? rows[1][col] : null;
      const okRow = first && (typeof first === "object" ? /\*/.test(first.f) || first.v === PRODUCTS[0][1] * PRODUCTS[0][2] : Number(first) === PRODUCTS[0][1] * PRODUCTS[0][2]);
      const flat = rows.flat();
      const grand = flat.some((v) => (typeof v === "object" && v ? /SUM/i.test(v.f) || v.v === PRODUCTS_TOTAL : Number(v) === PRODUCTS_TOTAL));
      return [
        [`an Excel file was delivered (${x.name})`, true],
        [`all ${PRODUCTS.length} products are still there`, PRODUCTS.every((p) => flat.includes(p[0]))],
        ["a Total column, computed per row", !!okRow],
        [`a grand total (${PRODUCTS_TOTAL} or a sum formula)`, grand],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 5, credits: 8 },
  },
  {
    id: "doc-summary",
    title: "an attached Word report summed up in five points, with its facts",
    steps: [{ say: "لخصلي هذا التقرير في 5 نقاط", make: async (dir) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, "Rapport annuel 2025.docx"); await makeReport(f); return f; } }],
    grade: async (c) => {
      const facts = [/4[,.]2/, /s[ée]tif|سطيف/i, /\b12\b/, /mars|مارس/i, /blida|البليدة|بليدة/i];
      const hit = facts.filter((f) => f.test(c.last)).length;
      const points = c.last.split("\n").filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length;
      return [
        [`the report's facts are in the summary (${hit} of ${facts.length})`, hit >= 4],
        [`five points (${points})`, points >= 4 && points <= 6],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 2, credits: 6 },
  },
  {
    id: "doc-write",
    title: "a one-page offer written as a Word file",
    steps: [{ say: "اكتبلي عرض تجاري في ملف Word، صفحة وحدة بالفرنسية، لخدمة تصميم موقع ويب لصاحب مطعم في وهران اسمو Le Méditerranée، السعر 60000 دج والتسليم في 10 أيام" }],
    grade: async (c) => {
      const x = c.files.find((f) => f.ext === "docx");
      if (!x) return [["a Word file was delivered", false]];
      const { text } = await c.readOffice(x.path);
      return [
        [`a Word file was delivered (${x.name})`, true],
        [`it is a real page of text (${text.length} characters)`, text.length > 700 && text.length < 6000],
        ["with what was asked: the restaurant, the price, the delay", /m[ée]diterran[ée]e/i.test(text) && /60[\s.,\u00a0\u202f]?000/.test(text) && /10\s*jours/i.test(text)],
        ["in French", /\b(nous|vous|votre|site)\b/i.test(text)],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 3, credits: 7 },
  },
  {
    id: "sheet-write",
    title: "a monthly budget as an Excel file with the right sums",
    steps: [{ say: "ديرلي جدول Excel لميزانية الشهر: الدخل 80000، الكراء 25000، الماكلة 20000، النقل 8000، والباقي ادخار. حط المجموع والادخار." }],
    grade: async (c) => {
      const x = c.files.find((f) => f.ext === "xlsx");
      if (!x) return [["an Excel file was delivered", false]];
      const flat = (await c.readXlsx(x.path)).flatMap((s) => s.rows.flat());
      const has = (n) => flat.some((v) => (typeof v === "object" && v ? v.v === n : Number(v) === n));
      const formula = flat.some((v) => typeof v === "object" && v && v.f);
      return [
        [`an Excel file was delivered (${x.name})`, true],
        ["the four amounts given are in it", [80000, 25000, 20000, 8000].every(has)],
        ["the savings come to 27,000 (a value or a formula)", has(27000) || formula],
        ["the expenses are summed (53,000 or a formula)", has(53000) || formula],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 3, credits: 7 },
  },
  {
    id: "slides-write",
    title: "a five-slide deck",
    steps: [{ say: "ديرلي عرض تقديمي PowerPoint من 5 شرائح على فوائد الطاقة الشمسية للمنازل في الجزائر" }],
    grade: async (c) => {
      const x = c.files.find((f) => f.ext === "pptx");
      if (!x) return [["a PowerPoint file was delivered", false]];
      const { text, slides } = await c.readOffice(x.path);
      return [
        [`a PowerPoint file was delivered (${x.name})`, true],
        [`five slides (${slides})`, slides >= 5 && slides <= 7],
        [`with real content (${text.length} characters)`, text.length > 500],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 4, credits: 8 },
  },
  {
    id: "research-cited",
    title: "a small piece of research: three real products with their sites, read from the web",
    steps: [{ say: "ابحثلي على 3 بدائل لـ Zapier (أدوات أتمتة) وعطيني لكل واحد: الاسم، رابط الموقع الرسمي، وجملة واحدة عليه" }],
    grade: async (c) => {
      const urls = [...new Set((c.last.match(/https?:\/\/[^\s)\]>"]+/g) || []).map((u) => u.replace(/[.,;]+$/, "")))];
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
      const read = c.toolText.toLowerCase();
      const grounded = urls.filter((u) => host(u) && read.includes(host(u)));
      return [
        [`searched or read the web (${[...new Set(c.tools)].join(", ") || "no tool"})`, c.tools.some((t) => /research|web_search|read_url|open_url/.test(t))],
        [`three products with a link (${urls.length} links)`, urls.length >= 3],
        [`every site named was seen in what was read (${grounded.length} of ${urls.length})`, urls.length > 0 && grounded.length === urls.length],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 6, credits: 10 },
  },
  {
    id: "list-build",
    title: "a list built from public data and delivered as a file",
    steps: [{ say: "لقالي 10 مطاعم في وهران مع العنوان ورقم الهاتف إذا كاين، واعطيني ملف Excel" }],
    grade: async (c) => {
      const x = c.files.find((f) => f.ext === "xlsx" || f.ext === "csv");
      if (!x) return [["an Excel or CSV file was delivered", false]];
      const rows = x.ext === "xlsx" ? (await c.readXlsx(x.path))[0].rows : fs.readFileSync(x.path, "utf8").trim().split("\n").map((l) => l.split(","));
      const names = rows.slice(1).map((r) => String(plain(r[0])).trim().toLowerCase()).filter(Boolean);
      // What the tools really found: collected places go straight into the work table, not through the bot.
      const found = new Set(Object.values(c.work.tables || {}).flatMap((t) => t.rows.map((r) => String(r[0] ?? "").trim().toLowerCase())));
      const read = c.toolText.toLowerCase();
      const real = names.filter((n) => found.has(n) || read.includes(n));
      return [
        [`an Excel or CSV file was delivered (${x.name})`, true],
        [`the 10 asked for, not more (${names.length})`, names.length === 10],
        [`every name comes from what the tools found (${real.length} of ${names.length})`, names.length > 0 && real.length === names.length],
      ];
    },
    limits: { cards: 0, questions: 0, calls: 8, credits: 14 },
  },
  {
    id: "routine-set",
    title: "something to do every day: set up as a routine, not answered once",
    steps: [{ say: "كل يوم على 8 تاع الصباح فكرني نشرب الدواء" }],
    grade: async (c) => {
      const r = c.routines[0];
      return [
        [`a routine exists (${c.routines.length})`, c.routines.length === 1],
        [`daily at 08:00 (${JSON.stringify(r?.schedule || null)})`, r?.schedule?.kind === "daily" && r.schedule.time === "08:00"],
      ];
    },
    limits: { cards: 1, questions: 0, calls: 3, credits: 6 },
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
  if (sc.zapier) fs.writeFileSync(path.join(out, "zapier-state.json"), JSON.stringify(sc.zapier));
  const base = Number(process.env.EVAL_PORT) || 4710;
  const [PORT, PROXY, ZAP] = [base + k * 3, base + 1 + k * 3, base + 2 + k * 3];
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, LAB_OUT: out, PROXY_PORT: String(PROXY), ZAP_PORT: String(ZAP) };
  const log = fs.openSync(path.join(out, "server.log"), "w");
  const kids = [
    spawn("node", [path.join(__dirname, "proxy.cjs")], { env, stdio: ["ignore", log, log] }),
    ...(sc.zapier ? [spawn("node", [path.join(__dirname, "zapier-standin.cjs")], { env, stdio: ["ignore", log, log] })] : []),
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
    const main = (await api("GET", "/api/main")).j;
    // A scenario without `zapier` is a bot with no connector at all: the starter bot as a new user has it.
    if (sc.zapier) {
      const add = await api("POST", "/api/mcp", { name: "Zapier", transport: "http", url: `http://127.0.0.1:${ZAP}/mcp` });
      const got = (await api("GET", `/api/bots/${main.botId}`)).j;
      const bot = got.bot || got;
      await api("PUT", `/api/bots/${main.botId}`, { ...bot, tools: { ...bot.tools, mcp: [add.j.id] } });
    }
    const chat = `dm-${main.botId}`;
    if (sc.seed) {
      // getChat reads the file each time: an earlier conversation is put there before the first message.
      const now = (await api("GET", `/api/chats/${chat}`)).j;
      const { entries, summary, openJob } = sc.seed(main.botId);
      fs.writeFileSync(path.join(data, "accounts", uid, "chats", `${chat}.json`), JSON.stringify({ id: chat, kind: "direct", name: "", memberIds: [main.botId], leadId: main.botId, createdAt: now.createdAt, updatedAt: Date.now(), entries, summary, openJob }));
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
      // A file made for this run (step.make) or a fixture (step.file).
      const file = step.make ? await step.make(path.join(out, "given")) : step.file;
      if (file) {
        const up = await api("POST", `/api/chats/${chat}/attachments`, fs.readFileSync(file), { "x-file-name": encodeURIComponent(path.basename(file)), "content-type": "application/octet-stream" });
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
          // A user who said "everyone" and sees a narrowed batch presses "all of them" (one press, no new message).
          // Only where the card shows that button: one batch on the card, and once.
          const all = !!sc.saidEveryone && !seen.pressedAll && p.approval.items.length === 1 && !!p.approval.items[0].batchAll;
          if (all) seen.pressedAll = (seen.pressedAll || 0) + 1;
          await post({ decisions: Object.fromEntries(p.approval.items.map((it) => [it.call.id, true])), ...(all ? { batchAll: true } : {}) });
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
    seen.chat = (await api("GET", `/api/chats/${chat}`)).j;
    seen.uid = uid;
  } finally {
    kids.forEach((x) => x.kill());
    fs.closeSync(log);
  }

  const read = (f) => { try { return fs.readFileSync(path.join(out, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const calls = read("calls.jsonl");
  const sent = lower(read("sent.jsonl").flatMap((s) => s.to));
  const want = new Set(lower(sc.expected ? sc.expected() : []));
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
    // What the first call of the conversation cost: the price of the fixed part (instructions and tools) when nothing is cached.
    firstCall: calls[0]?.credits ?? 0,
    firstPrompt: calls[0] ? prompt(calls[0]) : 0,
    userMessages: seen.userMessages || sc.steps.length,
    pressedAll: seen.pressedAll || 0,
    cutShort: !!seen.cut,
  };
  // What a scenario's own grade looks at: the files delivered, the tools used and what they returned, the words.
  const entries = seen.chat?.entries ?? [];
  const steps = entries.filter((e) => e.kind === "bot").flatMap((e) => e.steps || []);
  const ctx = {
    files: filesIn(path.join(out, "downloads")),
    tools: steps.filter((st) => st.role === "assistant").flatMap((st) => st.toolCalls.map((c) => c.name)),
    toolText: steps.filter((st) => st.role === "tool").flatMap((st) => st.results.map((r) => r.content)).join("\n"),
    said: seen.said,
    last: seen.texts.at(-1) || "",
    routines: (() => { try { return JSON.parse(fs.readFileSync(path.join(out, "data", "accounts", seen.uid, "routines.json"), "utf8")).routines || []; } catch { return []; } })(),
    work: (() => { try { return JSON.parse(fs.readFileSync(path.join(out, "data", "accounts", seen.uid, "work", `${seen.chat.id}.json`), "utf8")); } catch { return { tables: {}, notes: {} }; } })(),
    readXlsx, readOffice,
  };
  m.files = ctx.files.map((f) => f.name);
  const own = sc.grade ? await sc.grade(ctx).catch((e) => [[`the scenario's own checks could run (${e.message})`, false]]) : null;
  const checks = [
    ...(own ?? [
      [`every wanted address got the email (${m.reached} of ${m.wanted})`, m.reached === m.wanted],
      [`no address outside the wanted ones (${m.invented})`, m.invented === 0],
      [`nobody written to twice (${m.twice})`, m.twice === 0],
    ]),
    [`at most ${sc.limits.cards} approval card (${m.cards}${seen.cards.length ? `: ${seen.cards.map((x) => x.tool.replace(/^mcp_zapier_/, "")).join(", ")}` : ""})`, m.cards <= sc.limits.cards],
    [`at most ${sc.limits.questions} question to the user (${m.questions}), no plan to approve (${m.plans})`, m.questions <= sc.limits.questions && m.plans === 0],
    [`at most ${sc.limits.calls} model calls by the bot (${m.botCalls}, plus ${m.sideCalls} side calls)`, m.botCalls <= sc.limits.calls],
    [`at most ${sc.limits.credits} credits (${m.credits})`, m.credits <= sc.limits.credits],
    [`no request over 100,000 tokens (largest ${m.maxPrompt})`, m.maxPrompt <= 100_000],
    // (Only where it was the complaint: acting on a list. A deck about solar energy may well mention a law.)
    ...(sc.zapier ? [[`no lecture in the answers (${m.lecture})`, m.lecture === 0]] : []),
    ...(sc.noOldTopics ? [[`nothing about the old topics in what the bots said (${seen.said.filter((t) => OLD_TOPICS.test(t)).length})`, !seen.said.some((t) => OLD_TOPICS.test(t))]] : []),
  ];
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ id: sc.id, metrics: m, checks, cards: seen.cards, texts: seen.texts }, null, 1));
  return { m, checks, texts: seen.texts };
}

(async () => {
  if (!fs.existsSync(path.join(REAL, "session.json"))) return console.error(`No oovi session in ${REAL}: sign in to the desktop app first (or set OOVI_REAL_DATA).`), process.exit(2);
  if (!fs.existsSync(path.join(SERVER, "server.js"))) return console.error("No built server: run `npm run build` first."), process.exit(2);
  if (process.argv.includes("--list")) return void SCENARIOS.forEach((x) => console.log(`${x.id.padEnd(18)} ${x.zapier ? "connector" : "no connector"}  ${x.title}`));
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
    rows.push({ id: sc.id, ...r.m, passed: r.checks.filter((x) => x[1]).length, checks: r.checks.length });
  }
  console.log("\n" + ["scenario", "passed", "cards", "questions", "bot calls", "credits", "first call", "files"].join(" | "));
  for (const r of rows) console.log([r.id, `${r.passed}/${r.checks}`, r.cards, r.questions, r.botCalls, `${r.credits}${r.cutShort ? " (cut short)" : ""}`, r.firstCall, (r.files || []).join(", ").slice(0, 60)].join(" | "));
  console.log(`total: ${rows.reduce((a, r) => a + r.credits, 0).toFixed(1)} credits`);
  console.log(`\nresults in ${OUT_ROOT}`);
  process.exit(failed ? 1 : 0);
})();
