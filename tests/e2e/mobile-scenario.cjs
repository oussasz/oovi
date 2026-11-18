// The phone app (/m) in a phone-sized Chrome (iPhone 15 emulation), against the BUILT website (web/: run
// `npm run build` there first) behind a stand-in for the cloud API (tests/e2e/mobile-standin.cjs, the
// contract in docs/CLOUD-BUILD.md). Nothing leaves this machine. Checked:
//   A) signed out → the app's own sign-in; a wrong password says so; the right one opens the chats,
//   B) sync off → "Not synced yet" with the three steps; the API missing → the same screen, "coming soon",
//   C) the chat list: routine chats left out, pinned first, unread dot and tab badge, search in messages,
//      pin from the row's actions,
//   D) a chat: Markdown table, safe links, the approval card (Allow → POST /jobs decision → card goes),
//   E) sending: the message shows at once, the bot's live status arrives by long-poll, then its answer;
//      the message is never shown twice,
//   F) Stop while the bot works, G) "This needs your computer" and the queued-while-off note,
//   H) a voice note becomes text in the box (fake microphone), and "not available" when the service is off,
//   I) bots and groups, a new chat with a bot, a bot that is on the computer only,
//   J) settings: credits, devices, sync; connectors: names and on/off, never addresses, commands or keys
//      (not on the page, not in the phone's storage),
//   K) no sideways scroll at 320 px on every screen, L) Arabic: right to left,
//   M) offline: the app opens from the offline worker with the saved chats,
//   N) sign out asks first, then clears the phone's copy.
// With --shots, also writes the screenshots in docs/mobile/ (English and Arabic, light and dark).
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium, devices } = require("playwright");
const { startStandin } = require("./mobile-standin.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "web");
const NEXT_PORT = 3472;
const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(ROOT, "docs", "mobile");
const { defaultBrowserType: _ignored, ...IPHONE } = devices["iPhone 15"];

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && extra ? ` (${extra})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {
      /* not yet */
    }
    await sleep(step);
  }
  return false;
}

async function main() {
  if (!fs.existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
    console.error("Build the website first: cd web && npm run build");
    process.exit(2);
  }
  const next = spawn(process.execPath, [path.join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(NEXT_PORT), "-H", "127.0.0.1"], { cwd: WEB, stdio: "ignore" });
  const stop = async () => {
    try {
      next.kill();
    } catch {
      /* gone */
    }
  };
  process.on("exit", () => next.kill());
  const up = await until(async () => (await fetch(`http://127.0.0.1:${NEXT_PORT}/m/manifest.webmanifest`)).ok, 60_000, 300);
  if (!up) throw new Error("the website did not start");
  const sb = await startStandin({ port: PORT, nextPort: NEXT_PORT, lang: "en", replyDelayMs: 700 });
  const S = sb.state;
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const jobsOf = (kind) => S.jobs.filter((j) => j.kind === kind);

  try {
    // ---------- A) sign-in ----------
    let ctx = await browser.newContext({ ...IPHONE, locale: "en-US", deviceScaleFactor: 1 });
    await ctx.grantPermissions(["microphone"], { origin: BASE });
    let page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/m`);
    check("A signed out: the app's sign-in opens", await until(() => page.url().includes("/m/login")), page.url());
    check("A sign-in keeps where to go back", page.url().includes("next=%2Fm"));
    await page.fill('input[type="email"]', "phone.tester@example.test");
    await page.fill('input[type="password"]', "wrong-pass");
    await page.click('button[type="submit"]');
    check("A wrong password says so", await until(() => page.getByRole("alert").filter({ hasText: "Wrong email or password." }).isVisible()));
    await page.fill('input[type="password"]', "standin-pass");
    await page.click('button[type="submit"]');
    check("A right password opens the chats", await until(async () => page.url().endsWith("/m") && (await page.locator(".m-chats > li").count()) > 0, 10_000), page.url());

    // ---------- C) the chat list ----------
    const rows = page.locator(".m-chats > li");
    check("C five chats (the routine's chat is left out)", (await rows.count()) === 5, String(await rows.count()));
    check("C pinned on top: Lina", (await page.locator("#pinned-h + ul .m-chat__name").first().textContent()) === "Lina");
    check("C the API is called as this phone", S.requests.some((r) => r.path.startsWith("/api/v1/cloud") && /^phone:phone-/.test(r.device || "")));
    check("C nothing unread on the first open", (await page.locator(".m-chat__dot.is-on").count()) === 0);
    // A new reply in Studio, then the app comes back: one unread dot, a badge on the tab.
    const studio = S.chats.studio.chat;
    studio.entries.push({ id: "b9", kind: "bot", botId: "oovi", at: Date.now(), text: "Posted ✅", status: "done" });
    sb.bump("studio");
    await page.reload();
    check("C a new reply: unread dot", await until(async () => (await page.locator(".m-chat__dot.is-on").count()) === 1));
    check("C a new reply: badge on the Chats tab", (await page.locator(".m-tab .m-badge").textContent()) === "1");
    await page.fill('input[type="search"]', "oran");
    check("C search finds words inside messages", await until(async () => (await rows.count()) === 1 && (await page.locator(".m-chat__name").first().textContent()) === "Oovi"));
    await page.fill('input[type="search"]', "zzz");
    check("C search with no match says so", await until(() => page.getByText("No results for “zzz”").isVisible()));
    await page.fill('input[type="search"]', "");
    await page.getByRole("button", { name: "More actions for Rex" }).focus();
    await page.getByRole("button", { name: "More actions for Rex" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pin" }).click();
    check("C pin from the row's actions", await until(async () => (await page.locator("#pinned-h + ul .m-chat__name").allTextContents()).includes("Rex")));

    // ---------- D) a chat with an approval ----------
    await page.click('a[href="/m/c/dm-oovi"]');
    check("D the chat opens", await until(() => page.locator(".m-md table").isVisible()));
    check("D Markdown table: 3 rows", (await page.locator(".m-md table tbody tr").count()) === 3);
    const link = page.locator('.m-md a[href="https://all.accor.com/"]');
    check("D links open safely", (await link.getAttribute("target")) === "_blank" && (await link.getAttribute("rel"))?.includes("noopener"));
    check("D the approval card", await page.getByText("Oovi asks for your OK").isVisible());
    await page.getByRole("button", { name: "Allow" }).click();
    check("D Allow sends a decision job", await until(() => jobsOf("decision").length === 1));
    const dj = jobsOf("decision")[0];
    check("D the decision allows the action", dj && dj.chatId === "dm-oovi" && dj.payload.decisions["call-mail"] === true);
    check("D the card goes when the bot goes on", await until(async () => (await page.getByText("Oovi asks for your OK").count()) === 0 && (await page.getByText("Email sent to the hotel").isVisible())));
    check("D no tool results kept on the phone", !(await page.evaluate(() => localStorage.getItem("oovi.m.chats") || "")).includes("BIG TOOL RESULT"));

    // ---------- E) sending, live status, answer ----------
    const box = page.locator(".m-composer textarea");
    await box.fill("Book it for Friday");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("E the message shows at once", await until(() => page.locator(".m-bubble--me", { hasText: "Book it for Friday" }).isVisible(), 3000));
    check("E a message job with its entry id", await until(() => jobsOf("message").length === 1 && /^m[a-z0-9]{12}$/.test(jobsOf("message")[0].payload.entryId)));
    check("E the bot's live status arrives (long-poll)", await until(() => page.locator(".m-live", { hasText: "Searching the web" }).isVisible(), 6000));
    check("E the header says what it does", await until(() => page.locator(".m-chathead__sub.is-live").isVisible()));
    check("E then the next step", await until(() => page.locator(".m-live", { hasText: "Reading booking.com" }).isVisible(), 6000));
    check("E then the answer", await until(() => page.getByText("I asked for").isVisible(), 8000));
    check("E the message is shown once", (await page.locator(".m-bubble--me", { hasText: "Book it for Friday" }).count()) === 1);
    check("E the long-poll is used", S.requests.some((r) => r.path.startsWith("/api/v1/cloud/events?chatId=dm-oovi&after=")));

    // ---------- F) Stop ----------
    S.slowNext = true;
    await box.fill("Find flights to Paris");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("F Stop shows while the bot works", await until(() => page.getByRole("button", { name: "Stop" }).isVisible(), 6000));
    await until(() => page.locator(".m-live", { hasText: "Reading" }).isVisible(), 6000);
    await page.getByRole("button", { name: "Stop" }).click();
    check("F Stop sends a stop job", await until(() => jobsOf("stop").length === 1));
    check("F the reply shows Stopped", await until(() => page.locator(".m-msg__note", { hasText: "Stopped" }).isVisible(), 6000));

    // ---------- G) needs the computer ----------
    await page.goto(`${BASE}/m/c/dm-rex`);
    check("G 'This needs your computer'", await until(() => page.getByText("This needs your computer", { exact: true }).isVisible()));
    check("G the computer is off, with when it was last seen", await page.getByText(/Your computer is off · last seen 2 h ago/).isVisible());
    S.holdJobs = true;
    await page.goto(`${BASE}/m/c/dm-lina`);
    await page.locator(".m-composer textarea").fill("Any news?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("G queued while the computer is off: said plainly", await until(() => page.getByText("Your computer is off. Your message waits until it’s picked up.").isVisible(), 14_000));
    check("G the waiting message is marked", await page.getByText("Waiting to be picked up").isVisible());
    S.holdJobs = false;

    // ---------- H) voice note ----------
    await page.reload();
    await page.getByRole("button", { name: "Voice note" }).click();
    check("H recording shows", await until(() => page.getByText("Recording").isVisible()));
    await sleep(1300);
    await page.getByRole("button", { name: "Stop and turn into text" }).click();
    check("H the words land in the box to check", await until(async () => (await page.locator(".m-composer textarea").inputValue()) === "Book the cheapest one please", 6000));
    check("H the audio was sent as audio", !!S.lastAudio && /^audio\/(webm|mp4|ogg)/.test(S.lastAudio.mime) && S.lastAudio.bytes > 100, JSON.stringify(S.lastAudio));
    await page.locator(".m-composer textarea").fill("");
    S.transcribe = "off";
    await page.getByRole("button", { name: "Voice note" }).click();
    await sleep(800);
    await page.getByRole("button", { name: "Stop and turn into text" }).click();
    check("H service off: says so", await until(() => page.getByText("Voice notes aren’t available right now. Type your message instead.").isVisible(), 6000));
    S.transcribe = "ok";

    // ---------- I) bots ----------
    await page.goto(`${BASE}/m/bots`);
    check("I bots listed (hidden ones left out)", await until(async () => (await page.locator(".m-group .m-row--tall").count()) === 6));
    check("I the main bot first", (await page.locator(".m-section").first().textContent()).includes("Oovi"));
    check("I a computer-only bot is marked", await page.getByText("On your computer only").isVisible());
    await page.click('a[href="/m/c/dm-nova"]');
    check("I a bot opens its chat", await until(() => page.url().endsWith("/m/c/dm-nova")));
    S.chats["dm-rex"].deleted = true;
    await page.goto(`${BASE}/m/c/dm-rex`);
    check("I a bot with no chat yet: say hello, and write", await until(() => page.getByText("Say hello to Rex").isVisible()) && (await page.locator(".m-composer textarea").count()) === 1);
    S.chats["dm-rex"].deleted = false;
    await page.goto(`${BASE}/m/c/dm-sami`);
    check("I a computer-only bot: no box, and why", await until(() => page.locator(".m-composer--note", { hasText: "Sami works on your computer only" }).isVisible()) && (await page.locator(".m-composer textarea").count()) === 0);

    // ---------- J) settings and connectors ----------
    await page.goto(`${BASE}/m/settings`);
    check("J credits", await until(() => page.getByText("1,840.5").isVisible()));
    check("J the computer and its state", await page.getByText("Home PC").isVisible() && (await page.getByText(/Offline · 2 h ago/).isVisible()));
    check("J sync on, with the space used", await page.getByText(/3\.2 MB of 100 MB/).isVisible());
    check("J the phone uses theOovi only, said plainly", await page.getByText("On the phone, your bots use theOovi only. Your own API keys stay on your computer.").isVisible());
    await page.click('a[href="/m/settings/connectors"]');
    check("J connectors: names", await until(async () => (await page.locator(".m-row").count()) === 4));
    check("J connectors: on and off", (await page.locator(".m-state.is-on").count()) === 3 && (await page.locator(".m-state:not(.is-on)").count()) === 1);
    const html = await page.content();
    const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("\n"));
    const secrets = ["SECRET-TOKEN", "mcp.example.test", "GMAIL_KEY", "files-server", "SECRET-INSTRUCTIONS", "Authorization"];
    check("J no address, command, key name or instructions on the page", secrets.every((s) => !html.includes(s)), secrets.filter((s) => html.includes(s)).join());
    check("J …nor in the phone's storage", secrets.every((s) => !stored.includes(s)), secrets.filter((s) => stored.includes(s)).join());

    // ---------- K) 320 px ----------
    await page.setViewportSize({ width: 320, height: 640 });
    const wide = [];
    for (const u of ["/m", "/m/c/dm-oovi", "/m/c/studio", "/m/c/dm-rex", "/m/bots", "/m/settings", "/m/settings/connectors", "/m/offline"]) {
      await page.goto(BASE + u);
      await sleep(700);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      if (w > 320) wide.push(`${u}=${w}`);
    }
    check("K no sideways scroll at 320 px", wide.length === 0, wide.join(" "));
    await page.setViewportSize(IPHONE.viewport);

    // ---------- L) Arabic ----------
    await page.goto(`${BASE}/m/settings`);
    await page.getByRole("button", { name: /Language/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "العربية" }).click();
    check("L Arabic: right to left", await until(async () => (await page.evaluate(() => document.documentElement.dir)) === "rtl"));
    check("L Arabic words", await page.locator(".m-tab", { hasText: "المحادثات" }).isVisible());
    await page.reload();
    check("L Arabic stays after a reload (before the first paint)", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
    await page.getByRole("button", { name: /اللغة/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "English" }).click();

    // ---------- B) sync off / API missing ----------
    S.sync = false;
    await page.goto(`${BASE}/m`);
    // the phone's copy is from when sync was on: a full list again (since = null) empties it
    await page.evaluate(() => localStorage.removeItem("oovi.m.chats"));
    await page.reload();
    check("B sync off: 'Not synced yet'", await until(() => page.getByText("Not synced yet").isVisible()));
    check("B with the three steps", (await page.locator(".m-steps li").count()) === 3);
    S.sync = true;
    S.statusMissing = true;
    await page.reload();
    check("B the cloud API missing: coming soon", await until(() => page.getByText(/isn’t available on your account yet/).isVisible()));
    S.statusMissing = false;
    await page.getByRole("button", { name: "Check again" }).click();
    check("B Check again brings the chats", await until(async () => (await page.locator(".m-chats > li").count()) === 5));

    // ---------- M) offline ----------
    for (const u of ["/m", "/m/c/dm-oovi", "/m/bots", "/m/settings"]) {
      await page.goto(BASE + u);
      await sleep(400);
    }
    const sw = await until(() => page.evaluate(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller), 10_000);
    check("M the offline worker controls the app", sw);
    await ctx.setOffline(true);
    await page.goto(`${BASE}/m`).catch(() => {});
    check("M offline: the app opens with the saved chats", await until(async () => (await page.locator(".m-chats > li").count()) === 5, 8000));
    check("M offline: said plainly", await page.getByText("You’re offline. Showing what this phone saved.").isVisible());
    await page.goto(`${BASE}/m/c/dm-oovi`).catch(() => {});
    check("M offline: a chat seen before opens", await until(() => page.locator(".m-md table").isVisible(), 8000));
    await ctx.setOffline(false);

    // ---------- N) sign out ----------
    await page.goto(`${BASE}/m/settings`);
    await page.getByRole("button", { name: "Sign out" }).click();
    check("N sign out asks first", await page.getByRole("dialog").getByText(/Sign out of oovi on this phone\?/).isVisible());
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    check("N signed out: back to sign-in", await until(() => page.url().includes("/m/login")));
    check("N the phone's copy is gone", (await page.evaluate(() => localStorage.getItem("oovi.m.chats"))) === null);
    check("N no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    if (SHOTS) await screenshots(browser, sb);
  } finally {
    await browser.close();
    await sb.close();
    await stop();
  }
  console.log(`\nmobile scenario: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

async function screenshots(browser, sb) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const S = sb.state;
  const written = [];
  for (const lang of ["en", "ar"]) {
    for (const scheme of ["light", "dark"]) {
      sb.setLang(lang);
      S.sync = true;
      S.signedIn = true;
      // The computer is on in the light pictures, off in the dark ones (both states are shown).
      S.devices[0].online = scheme === "light";
      const ctx = await browser.newContext({ ...IPHONE, locale: lang === "ar" ? "ar-DZ" : "en-US", colorScheme: scheme });
      await ctx.addCookies([{ name: "standin", value: "1", url: BASE }]);
      await ctx.addInitScript(([l]) => {
        if (!localStorage.getItem("oovi.m.prefs")) localStorage.setItem("oovi.m.prefs", JSON.stringify({ lang: l, theme: "auto" }));
        if (!localStorage.getItem("oovi.m.seen")) localStorage.setItem("oovi.m.seen", JSON.stringify({ "dm-oovi": Date.now(), "dm-nova": Date.now(), "dm-rex": Date.now(), "dm-lina": Date.now(), studio: 0 }));
      }, [lang]);
      const page = await ctx.newPage();
      const shot = async (name, url, prep) => {
        await page.goto(BASE + url);
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(900);
        if (prep) await prep(page);
        const file = path.join(SHOT_DIR, `${lang}-${scheme}-${name}.jpg`);
        await page.screenshot({ path: file, type: "jpeg", quality: 82 });
        written.push(path.relative(ROOT, file));
      };
      await shot("chats", "/m");
      await shot("chat-approval", "/m/c/dm-oovi", async (p) => p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)));
      await shot("chat-live", "/m/c/dm-nova");
      await shot("needs-computer", "/m/c/dm-rex");
      await shot("group", "/m/c/studio");
      await shot("bots", "/m/bots");
      await shot("settings", "/m/settings");
      await shot("connectors", "/m/settings/connectors");
      if (scheme === "light") {
        await shot("chat-composer-voice", "/m/c/dm-lina", async (p) => {
          await p.locator(".m-composer textarea").fill(lang === "ar" ? "واش كاين جديد على العملاء؟" : "Any news on the prospects?");
        });
        S.sync = false;
        await page.evaluate(() => localStorage.removeItem("oovi.m.chats"));
        await shot("not-synced", "/m");
        S.sync = true;
        await ctx.clearCookies();
        S.signedIn = false;
        await shot("sign-in", "/m/login");
        S.signedIn = true;
      }
      await ctx.close();
    }
  }
  console.log(`screenshots: ${written.length} written in docs/mobile/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
