// Screenshots of the desktop app's main screens (docs/desktop-refresh/), in English and Arabic, light and dark:
// Home, a chat with a bot answer + table + approval card, a group chat, the Canvas, Settings, Marketplace and
// the bot editor. Seeds a throwaway data folder with sample chats; a stand-in for oovi's website; nothing leaves
// this machine. Needs a build (npm run build). Run: node tests/e2e/desktop-shots.cjs <prefix> [outDir]
// e.g. node tests/e2e/desktop-shots.cjs before
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./server-guard.cjs"); // fail fast if the test server exits on its own (port taken, crash)
const { spawn } = require("node:child_process");

const PREFIX = process.argv[2] || "shot";
const OUT = path.resolve(process.argv[3] || path.join(__dirname, "../../docs/desktop-refresh"));
const PORT = 3361;
const CLOUD_PORT = 3362;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const status = { state: "ok", message: null, displayName: "theOovi", balance: 999, dailyLimit: 500, dailyUsed: 1, resetsAt: new Date(Date.now() + 864e5).toISOString(), plan: { id: "free", name: "Free" }, planUntil: null, maxInputTokens: 100000, links: {} };
const cloud = http
  .createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(obj === undefined ? "" : JSON.stringify(obj));
    };
    const url = req.url.split("?")[0];
    if (url === "/api/v1/ai/status") return send(200, status);
    if (url === "/api/v1/me") return send(200, { user: { id: "p1test", email: "tester@example.test", name: "Sara", image: null } });
    if (url === "/api/v1/catalog") return send(200, { items: [] });
    return send(204);
  })
  .listen(CLOUD_PORT, "127.0.0.1");

const TEXT = {
  en: {
    ask: "Find me 3 hotels in Oran for next weekend, under 12,000 DA a night",
    answer:
      "I found **3 hotels** in Oran that fit, and put them in the **Hotels** table:\n\n- **Ibis Oran**: 9,800 DA a night, rated 4.1\n- **Hotel Andalous**: 11,200 DA, rated 4.3\n- **Royal Oran**: 11,900 DA, rated 4.6\n\nThe cheapest is **Ibis**, close to the seafront. Shall I email them a booking request?",
    yes: "Yes, send it",
    approval: "Send an email in Gmail\nTo: reservations@ibis-oran.example\nSubject: Booking request, Nov 21–23",
    group: "Café team",
    gAsk: "@Scout find what our customers say about the new menu, then @Quill write a short post",
    scout: "I read 42 reviews from the last month:\n\n- **Liked:** the lighter dishes and the new desserts\n- **Not liked:** waiting times at lunch\n- **Asked for:** more vegetarian choices",
    quill: "Here is a draft:\n\n> Our new menu is here, and you told us what you think. Thank you! Lighter dishes, new desserts, and soon more vegetarian choices. 🌿",
    nova: "Good draft. One fix: say what we do about lunch waiting times, people asked for it.",
    table: "Hotels",
    cols: ["Hotel", "Price a night", "Rating"],
    rows: [["Ibis Oran", "9,800 DA", "4.1"], ["Hotel Andalous", "11,200 DA", "4.3"], ["Royal Oran", "11,900 DA", "4.6"]],
  },
  ar: {
    ask: "لقى لي 3 فنادق في وهران للويكاند الجاي، أقل من 12000 دينار لليلة",
    answer:
      "وجدت **3 فنادق** مناسبة في وهران، ووضعتها في جدول **الفنادق**:\n\n- **إيبيس وهران**: 9 800 دج لليلة، تقييم 4.1\n- **فندق الأندلس**: 11 200 دج، تقييم 4.3\n- **رويال وهران**: 11 900 دج، تقييم 4.6\n\nالأرخص هو **إيبيس**، قريب من الواجهة البحرية. هل أرسل طلب الحجز بالبريد؟",
    yes: "إيه، أرسل لهم",
    approval: "إرسال بريد في Gmail\nإلى: reservations@ibis-oran.example\nالموضوع: طلب حجز، 21-23 نوفمبر",
    group: "فريق المقهى",
    gAsk: "@Scout شوف واش قالوا الزبائن على المنيو الجديد، ومن بعد @Quill اكتب منشور قصير",
    scout: "قرأت 42 تقييما من الشهر الماضي:\n\n- **أعجبهم:** الأطباق الخفيفة والحلويات الجديدة\n- **لم يعجبهم:** وقت الانتظار في الغداء\n- **طلبوا:** خيارات نباتية أكثر",
    quill: "هذه مسودة:\n\n> قائمتنا الجديدة هنا، وأخبرتمونا برأيكم. شكرا! أطباق أخف، حلويات جديدة، وقريبا خيارات نباتية أكثر. 🌿",
    nova: "مسودة جيدة. تعديل واحد: قولوا ماذا سنفعل بخصوص وقت الانتظار في الغداء، الناس طلبوا ذلك.",
    table: "الفنادق",
    cols: ["الفندق", "السعر لليلة", "التقييم"],
    rows: [["إيبيس وهران", "9 800 دج", "4.1"], ["فندق الأندلس", "11 200 دج", "4.3"], ["رويال وهران", "11 900 دج", "4.6"]],
  },
};

const usage = { input: 1200, output: 160 };
function seed(acc, bots, L) {
  const by = (n) => bots.find((b) => b.name === n);
  const oovi = by("Oovi");
  const [scout, quill, nova] = ["Scout", "Quill", "Nova"].map(by);
  const t0 = Date.now() - 50 * 60e3;
  const dm = `dm-${oovi.id}`;
  const callId = "toolu_shot1";
  const chat = {
    id: dm,
    kind: "direct",
    name: "",
    memberIds: [oovi.id],
    leadId: oovi.id,
    createdAt: t0,
    updatedAt: t0 + 20 * 60e3,
    entries: [
      { id: "u1", kind: "user", text: L.ask, at: t0 },
      { id: "b1", kind: "bot", botId: oovi.id, at: t0 + 60e3, steps: [{ role: "assistant", text: "", toolCalls: [{ id: "toolu_t1", name: "work_table", input: { action: "write", table: L.table } }] }, { role: "tool", results: [{ id: "toolu_t1", name: "work_table", content: `Wrote 3 rows to "${L.table}".` }] }], text: L.answer, status: "done", usage, credits: 1.4, model: "theOovi" },
      { id: "u2", kind: "user", text: L.yes, at: t0 + 15 * 60e3 },
      { id: "b2", kind: "bot", botId: oovi.id, at: t0 + 15 * 60e3 + 5e3, steps: [], text: "", status: "waiting", usage: { input: 0, output: 0 } },
    ],
    pending: {
      queue: [],
      turnsLeft: 4,
      approval: {
        entryId: "b2",
        botId: oovi.id,
        at: Date.now(),
        items: [{ call: { id: callId, name: "mcp__gmail__send_email", input: { to: "reservations@ibis-oran.example" } }, summary: L.approval, detail: '{\n  "to": "reservations@ibis-oran.example"\n}', scope: { key: "tool:mcp__gmail__send_email", kind: "tool", label: "Gmail: send email" } }],
      },
    },
  };
  const group = {
    id: "studio1",
    kind: "group",
    name: L.group,
    memberIds: [oovi.id, scout.id, quill.id, nova.id],
    leadId: oovi.id,
    orchestrate: false,
    createdAt: t0,
    updatedAt: t0 + 30 * 60e3,
    entries: [
      { id: "g1", kind: "user", text: L.gAsk, at: t0 + 25 * 60e3 },
      { id: "g2", kind: "bot", botId: scout.id, at: t0 + 26 * 60e3, steps: [], text: L.scout, status: "done", usage, credits: 2.1, model: "theOovi", handoff: [quill.id] },
      { id: "g3", kind: "bot", botId: quill.id, at: t0 + 27 * 60e3, steps: [], text: L.quill, status: "done", usage, credits: 0.9, model: "theOovi" },
      { id: "g4", kind: "bot", botId: nova.id, at: t0 + 28 * 60e3, steps: [], text: L.nova, status: "done", usage, credits: 0.6, model: "theOovi" },
    ],
  };
  fs.mkdirSync(path.join(acc, "chats"), { recursive: true });
  fs.writeFileSync(path.join(acc, "chats", `${dm}.json`), JSON.stringify(chat));
  fs.writeFileSync(path.join(acc, "chats", "studio1.json"), JSON.stringify(group));
  fs.mkdirSync(path.join(acc, "work"), { recursive: true });
  fs.writeFileSync(path.join(acc, "work", `${dm}.json`), JSON.stringify({ tables: { [L.table]: { columns: L.cols, rows: L.rows, updatedAt: t0 + 60e3 } }, notes: {} }));
  return { dm, group: "studio1", oovi };
}

async function run(lang) {
  const DATA = path.join(os.tmpdir(), `oovi-shots-${lang}`);
  fs.rmSync(DATA, { recursive: true, force: true });
  const server = spawn(process.execPath, [path.join(__dirname, "server.cjs")], {
    env: { ...process.env, OOVI_TEST_DATA: DATA, OOVI_TEST_USER_NAME: "Sara", OOVI_TELEGRAM_API: "http://127.0.0.1:1", OOVI_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}`, PORT: String(PORT) },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`${BASE}/api/bots`);
        if (r.ok) break;
      } catch {}
      await sleep(250);
    }
    const bots = (await (await fetch(`${BASE}/api/bots`)).json()).bots ?? (await (await fetch(`${BASE}/api/bots`)).json());
    const ids = seed(path.join(DATA, "accounts", "p1test"), Array.isArray(bots) ? bots : bots.bots, TEXT[lang]);
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme, locale: lang === "ar" ? "ar-DZ" : "en-US", reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const shot = async (name) => {
        await sleep(700);
        await page.screenshot({ path: path.join(OUT, `${PREFIX}-${lang}-${theme}-${name}.jpg`), type: "jpeg", quality: 78 });
      };
      const go = async (url) => {
        await page.goto(BASE + url, { waitUntil: "networkidle" });
        await sleep(600);
      };
      await go("/");
      await shot("home");
      await page.evaluate((id) => localStorage.removeItem(`oovi.canvas.${id}`), ids.dm);
      await go(`/c/${ids.dm}`);
      await page.evaluate(() => {
        const t = document.querySelector(".thread");
        if (t) t.scrollTop = t.scrollHeight;
      });
      await shot("chat-approval");
      await go(`/c/${ids.group}`);
      await shot("group");
      await page.evaluate((id) => localStorage.setItem(`oovi.canvas.${id}`, "1"), ids.dm);
      await go(`/c/${ids.dm}`);
      await shot("canvas");
      await page.evaluate((id) => localStorage.removeItem(`oovi.canvas.${id}`), ids.dm);
      await go("/settings");
      await sleep(800);
      await shot("settings");
      await go("/library");
      await shot("marketplace");
      await go(`/bots/${ids.oovi.id}`);
      await shot("bot-editor");
      await ctx.close();
    }
    await browser.close();
  } finally {
    server.kill();
    await sleep(500);
  }
}

(async () => {
  for (const lang of ["en", "ar"]) await run(lang);
  cloud.close();
  console.log("screenshots in", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
