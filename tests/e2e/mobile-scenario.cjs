// The phone app (/m) in a phone-sized Chrome (iPhone 15 emulation), against the BUILT website (web/: run
// `npm run build` there first) behind a stand-in for the cloud API (tests/e2e/mobile-standin.cjs, the
// contract in docs/CLOUD-BUILD.md). Nothing leaves this machine. Checked:
//   A) signed out → the app's own sign-in; a wrong password says so; the right one opens the chats,
//   B) sync off → "Not synced yet" with the three steps; the API missing → the same screen, "coming soon",
//   C) the one list: routine chats left out, pinned first, a bot with no chat under "Start a chat", unread count,
//      search in messages, pin and archive from the row's actions, the profile picture opens Settings,
//   D) a chat: Markdown table, safe links, the approval card (Allow → POST /jobs decision → card goes),
//   E) sending: the message shows at once, the bot's live status arrives by long-poll, then its answer;
//      the message is never shown twice,
//   F) Stop while the bot works, G) "This needs your computer" and the queued-while-off note,
//   H) a voice note becomes text in the box (fake microphone), and "not available" when the service is off,
//   I) "+ Bot" and "+ Group" (saved to the account's setup, a conflict merged again), the new chat opens and
//      sends; delete from the row's actions (asks first); the old Bots page lands on the list; a new chat with a
//      bot; a bot that is on the computer only,
//   J) settings: credits, devices, sync; connectors: names and on/off, never addresses, commands or keys
//      (not on the page, not in the phone's storage),
//   K) no sideways scroll at 320 px on every screen, L) Arabic: right to left,
//   M) offline: the app opens from the offline worker with the saved chats,
//   N) sign out asks first, then clears the phone's copy,
//   X) the website: sign-in lands on /app, "Open oovi", /account → /app/settings (Paddle's ?billing kept), and every
//      account action from Settings (confirm email, Manage billing, free plan, name, photo, password, news emails,
//      delete account with its password); /app on a narrow window is one column with the web app's look,
//   Y) tap a face: bot editor (name rule, role, abilities, "Your picture", hide, delete; saved with a 409 merged
//      again) and group editor (name, members, leader); the chat's tools (find, download Markdown, pin, the
//      computer-only ones shown as such), message actions, effort and plan sent with a message, routines.
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
const SHOTS_ONLY = process.argv.includes("--shots-only");
const SHOTS = SHOTS_ONLY || process.argv.includes("--shots");
const SHOT_DIR = path.join(ROOT, "docs", "mobile");
const { defaultBrowserType: _ignored, ...IPHONE } = devices["iPhone 15"];

let pass = 0;
let fail = 0;
let shotPage = null;
/** Like check, but waits for the failure picture (OOVI_FAIL_SHOTS) before the scenario moves on. */
const checkNow = async (name, ok, extra = "") => {
  if (!ok && shotPage && process.env.OOVI_FAIL_SHOTS) {
    await shotPage.screenshot({ path: path.join(process.env.OOVI_FAIL_SHOTS, `now-${name.replace(/\W+/g, "_").slice(0, 50)}.png`) }).catch(() => {});
    const html = await shotPage.locator(".m-thread").innerText().catch(() => "");
    fs.writeFileSync(path.join(process.env.OOVI_FAIL_SHOTS, `now-${name.replace(/\W+/g, "_").slice(0, 50)}.txt`), html + "\n" + JSON.stringify(extra));
  }
  check(name, ok, typeof extra === "string" ? extra : "");
};
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else fail++;
  // OOVI_FAIL_SHOTS=<folder>: a picture of the screen for each failed check.
  if (!ok && shotPage && process.env.OOVI_FAIL_SHOTS) shotPage.screenshot({ path: path.join(process.env.OOVI_FAIL_SHOTS, `${name.replace(/\W+/g, "_").slice(0, 60)}.png`) }).catch(() => {});
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
  const jobsOf = (kind) => S.jobs.filter((j) => j.kind === kind && j.jobId !== "job-rex");

  try {
    if (SHOTS_ONLY) return await screenshots(browser, sb);
    // ---------- A) sign-in ----------
    let ctx = await browser.newContext({ ...IPHONE, locale: "en-US", deviceScaleFactor: 1 });
    await ctx.grantPermissions(["microphone"], { origin: BASE });
    let page = await ctx.newPage();
    shotPage = page;
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
    check("C five chats and Sami to start (the routine's chat is left out)", (await rows.count()) === 6, String(await rows.count()));
    check("C a bot with no chat yet: under 'Start a chat', with its role", (await page.locator("#list-start + ul .m-chat").textContent()).includes("Desktop helper"));
    check("C no tab bar any more", (await page.locator(".m-tabs, .m-tab").count()) === 0);
    check("C pinned on top: Lina", (await page.locator("#list-pinned + ul .m-chat__name").first().textContent()) === "Lina");
    check("C the API is called as this phone", S.requests.some((r) => r.path.startsWith("/api/v1/cloud") && /^phone:phone-/.test(r.device || "")));
    check("C nothing unread on the first open", (await page.locator(".m-count").count()) === 0);
    // A new reply in Studio, then the app comes back: an unread count on its row.
    const studio = S.chats.studio.chat;
    studio.entries.push({ id: "b9", kind: "bot", botId: "oovi", at: Date.now(), text: "Posted ✅", status: "done" });
    sb.bump("studio");
    await page.reload();
    check("C a new reply: an unread count on the row", await until(async () => (await page.locator(".m-chat", { hasText: "Studio" }).locator(".m-count").textContent()) === "1"));
    await page.fill('input[type="search"]', "oran");
    check("C search finds words inside messages", await until(async () => (await rows.count()) === 1 && (await page.locator(".m-chat__name").first().textContent()) === "Oovi"));
    await page.fill('input[type="search"]', "zzz");
    check("C search with no match says so", await until(() => page.getByText("No results for “zzz”").isVisible()));
    await page.fill('input[type="search"]', "");
    await page.getByRole("button", { name: "More actions for Rex" }).focus();
    await page.getByRole("button", { name: "More actions for Rex" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pin" }).click();
    check("C pin from the row's actions", await until(async () => (await page.locator("#list-pinned + ul .m-chat__name").allTextContents()).includes("Rex")));
    await page.getByRole("button", { name: "More actions for Studio" }).focus();
    await page.getByRole("button", { name: "More actions for Studio" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    check("C archive: the chat leaves the list, 'Archived' shows its unread", await until(async () => (await page.locator(".m-chats .m-chat__name", { hasText: "Studio" }).count()) === 0 && (await page.locator(".m-archrow").textContent()).includes("Archived")));
    await page.click(".m-archrow");
    check("C the archived chats", await until(async () => page.url().endsWith("/m/archived") && (await page.locator(".m-chats .m-chat__name").allTextContents()).join() === "Studio"));
    await page.getByRole("button", { name: "More actions for Studio" }).focus();
    await page.getByRole("button", { name: "More actions for Studio" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unarchive" }).click();
    await page.goto(`${BASE}/m`);
    check("C unarchive brings it back", await until(async () => (await page.locator(".m-chats .m-chat__name", { hasText: "Studio" }).count()) === 1 && (await page.locator(".m-archrow").count()) === 0));
    await page.getByRole("link", { name: "Your profile and settings" }).click();
    check("C the profile picture opens Settings", await until(() => page.url().endsWith("/m/settings") && page.getByText("phone.tester@example.test", { exact: true }).isVisible()));
    await page.getByRole("button", { name: "Chats" }).click();
    check("C …and Settings goes back to the chats", await until(() => page.url().endsWith("/m")));

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
    check("E answered: double ticks marked read", await page.locator(".m-bubble--me", { hasText: "Book it for Friday" }).locator(".m-sr-only", { hasText: "Answered" }).count() === 1);
    // Long press (right click here) → Reply → the reply goes with the message.
    await page.locator(".m-bubble--bot", { hasText: "I asked for" }).click({ button: "right" });
    await page.getByRole("dialog").getByRole("button", { name: "Reply", exact: true }).click();
    check("E reply: the bar above the box", await until(() => page.locator(".m-replybar", { hasText: "Replying to Oovi" }).isVisible()));
    await box.fill("For two people");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const replyEntry = S.chats["dm-oovi"].chat.entries.find((x) => x.kind === "bot" && /I asked for/.test(x.text));
    check("E reply: the job says which message it answers", await until(() => jobsOf("message").some((j) => j.payload.text === "For two people" && j.payload.replyTo === replyEntry.id)));
    check("E reply: the message shows the quote", await until(() => page.locator(".m-bubble--me", { hasText: "For two people" }).locator(".m-quote").isVisible()));
    check("E reply: answered", await until(() => jobsOf("message").filter((j) => j.payload.text === "For two people").every((j) => j.status === "done"), 10_000));
    check("E the long-poll is used", S.requests.some((r) => r.path.startsWith("/api/v1/cloud/events?chatId=dm-oovi&after=")));

    // ---------- F) Stop ----------
    S.slowNext = true;
    await box.fill("Find flights to Paris");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("F Stop shows while the bot works", await until(() => page.getByRole("button", { name: "Stop" }).isVisible(), 6000));
    await until(() => page.locator(".m-live", { hasText: "Reading" }).isVisible(), 6000);
    await page.getByRole("button", { name: "Stop" }).click();
    check("F Stop sends a stop job", await until(() => jobsOf("stop").length === 1));
    await checkNow("F the reply shows Stopped", await until(async () => (await page.locator(".m-msg__note", { hasText: "Stopped" }).count()) === 1, 6000), S.chats["dm-oovi"].chat.entries.slice(-3).map((e) => [e.kind, e.status, e.text.slice(0, 30)]));

    // ---------- G) needs the computer ----------
    await page.goto(`${BASE}/m/c/dm-rex`);
    check("G 'This needs your computer'", await until(() => page.getByText("This needs your computer", { exact: true }).isVisible()));
    check("G the computer is off, with when it was last seen", await page.getByText(/Your computer is off · last seen 2 h ago/).isVisible());
    S.holdJobs = true;
    await page.goto(`${BASE}/m/c/dm-lina`);
    await page.locator(".m-composer textarea").fill("Any news?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("G queued while the computer is off: said plainly", await until(() => page.getByText("Your computer is off. Your message waits until it’s picked up.").isVisible(), 14_000));
    check("G the waiting message has one tick (sent, not picked up)", (await page.locator(".m-bubble--out", { hasText: "Any news?" }).locator(".m-sr-only", { hasText: "Sent" }).count()) === 1);
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

    // ---------- I) "+ Bot", "+ Group", delete, a new chat ----------
    await page.goto(`${BASE}/m/bots`);
    check("I the old Bots page lands on the list", await until(() => page.url().endsWith("/m") && page.locator(".m-chats").first().isVisible()));
    await page.getByRole("button", { name: "Bot", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name", { exact: true }).fill("Two words");
    await sheet.getByRole("button", { name: "Create" }).click();
    check("I a bot's name is one word", await until(() => sheet.getByRole("alert").filter({ hasText: "One word only" }).isVisible()));
    await sheet.getByLabel("Name", { exact: true }).fill("nova");
    await sheet.getByRole("button", { name: "Create" }).click();
    check("I …and not another bot's name", await until(() => sheet.getByRole("alert").filter({ hasText: "already has this name" }).isVisible()));
    await sheet.getByLabel("Name", { exact: true }).fill("Mira");
    await sheet.getByLabel("Role", { exact: true }).fill("Accountant");
    await sheet.getByRole("button", { name: "Another face" }).click();
    S.setupConflicts = 1; // a computer saves in between: read again, add again
    await sheet.getByRole("button", { name: "Create" }).click();
    const miraKey = () => Object.keys(S.items).find((k) => k.startsWith("bot:") && S.items[k].name === "Mira");
    check("I + Bot: saved to the account's setup (after a conflict), the rest kept", await until(() => !!miraKey()) && S.items[miraKey()].role === "Accountant" && /^bot:[0-9a-f]{12}$/.test(miraKey()) && !!S.items["bot:nova"] && S.setupConflicts === 0);
    check("I + Bot: its chat opens", await until(() => page.url().endsWith(`/m/c/dm-${miraKey().slice(4)}`) && page.getByText("Say hello to Mira").isVisible()));
    await page.goto(`${BASE}/m`);
    check("I + Bot: in the list, under 'Start a chat'", await until(async () => (await page.locator("#list-start + ul .m-chat__name").allTextContents()).includes("Mira")));
    await page.getByRole("button", { name: "Group", exact: true }).click();
    await sheet.getByLabel("Name", { exact: true }).fill("Finance");
    await sheet.getByRole("checkbox", { name: /Mira/ }).click();
    await sheet.getByRole("checkbox", { name: /Nova/ }).click();
    await sheet.getByRole("button", { name: "Create" }).click();
    const finKey = () => Object.keys(S.items).find((k) => k.startsWith("group:") && S.items[k].name === "Finance");
    check("I + Group: saved with its bots, the first one leads", await until(() => !!finKey()) && S.items[finKey()].memberIds.join() === `${miraKey().slice(4)},nova` && S.items[finKey()].leadId === miraKey().slice(4));
    check("I + Group: its chat opens", await until(() => page.url().endsWith(`/m/c/${finKey().slice(6)}`) && page.locator(".m-composer textarea").isVisible()));
    await page.locator(".m-composer textarea").fill("Hello team");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("I the new group's first message goes to the computer", await until(() => jobsOf("message").some((j) => j.chatId === finKey().slice(6) && j.payload.text === "Hello team")));
    check("I …and its answer comes back", await until(() => page.getByText("I asked for").isVisible(), 10_000));
    const finId = finKey().slice(6);
    await page.goto(`${BASE}/m`);
    await page.getByRole("button", { name: "More actions for Finance" }).focus();
    await page.getByRole("button", { name: "More actions for Finance" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    check("I delete asks first", await until(() => page.getByRole("dialog").getByText(/Delete the chat with Finance on all your devices\?/).isVisible()));
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    check("I delete: gone from every device, and the group from the setup", await until(() => S.deletedChats.includes(finId) && !finKey()));
    check("I …and from the list", await until(async () => (await page.locator(".m-chat__name", { hasText: "Finance" }).count()) === 0));
    await page.getByRole("button", { name: "New chat" }).click();
    check("I new chat: every bot and group to pick", await until(async () => (await page.getByRole("dialog").locator(".m-chat__name").allTextContents()).includes("Mira")));
    await page.getByRole("dialog").locator('a[href="/m/c/dm-nova"]').click();
    check("I a bot opens its chat", await until(() => page.url().endsWith("/m/c/dm-nova")));
    S.chats["dm-rex"].deleted = true;
    await page.goto(`${BASE}/m/c/dm-rex`);
    const t0 = Date.now();
    await until(() => page.getByText("Say hello to Rex").isVisible(), 20_000);
    console.log(`(hello after ${Date.now() - t0} ms)`);
    await checkNow("I a bot with no chat yet: say hello, and write", (await until(() => page.getByText("Say hello to Rex").isVisible())) && (await page.locator(".m-composer textarea").count()) === 1, page.url());
    S.chats["dm-rex"].deleted = false;
    await page.goto(`${BASE}/m/c/dm-sami`);
    check("I a computer-only bot: no box, and why", await until(() => page.locator(".m-composer--note", { hasText: "Sami works on your computer only" }).isVisible()) && (await page.locator(".m-composer textarea").count()) === 0);

    // ---------- J) settings and connectors ----------
    await page.goto(`${BASE}/m/settings`);
    check("J credits", await until(() => page.getByText("1,840.5").isVisible()));
    check("J the computer and its state", await page.getByText("Home PC").isVisible() && (await page.getByText(/Offline · 2 h ago/).isVisible()));
    check("J sync on, with the space used", await page.getByText(/3\.2 MB of 100 MB/).isVisible());
    check("J the phone uses theOovi only, said plainly", await page.getByText("On your phone and on the web, your bots use theOovi only. Your own API keys stay on your computer.").isVisible());
    await page.click('a[href="/m/connectors"]');
    const crow = (name) => page.locator(".m-row--conn", { hasText: name });
    check("J connectors: the account's four", await until(async () => (await page.locator(".m-row--conn").count()) === 4));
    check("J connectors: signed in, off, on the computer", (await crow("Gmail").textContent()).includes("Signed in") && (await crow("Google Calendar").textContent()).includes("Off") && (await crow("Computer files").textContent()).includes("Runs on your computer"));
    await crow("Notion").getByRole("switch").click();
    check("J on/off from the list is saved", await until(() => S.vaultPuts.some((x) => x.id === "notion" && x.data.enabled === false)));
    check("J …keeping the connector's key", S.vaultPuts.find((x) => x.id === "notion").data.headers.Authorization === "Bearer SECRET-HEADER-VALUE");
    const secrets = ["SECRET-OAUTH-TOKEN", "SECRET-HEADER-VALUE", "SECRET-TOKEN", "mcp.example.test", "GMAIL_KEY", "files-server", "SECRET-INSTRUCTIONS"];
    const leaks = async () => {
      const html = await page.content();
      const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("\n"));
      return secrets.filter((x) => html.includes(x) || stored.includes(x));
    };
    check("J no key, token, address or command on the page or in the phone's storage", (await leaks()).length === 0, (await leaks()).join());
    await crow("Gmail").getByRole("link").click();
    check("J a connector's page: its bots", await until(async () => (await page.getByRole("checkbox", { checked: true }).count()) === 2));
    await page.getByRole("checkbox", { name: "Rex" }).click();
    check("J choose a bot", await until(() => S.vaultPuts.some((x) => x.id === "gmail" && x.data.bots.includes("rex") && x.data.bots.includes("lina"))));
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    check("J sign out keeps the connector, drops the sign-in", await until(() => S.vaultPuts.some((x) => x.id === "gmail" && !x.data.oauth && x.data.url)) && !!S.vault.gmail);
    check("J …then it says to sign in", await until(() => page.locator(".m-conn-head", { hasText: "Sign in needed" }).isVisible()));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    check("J sign in: back in the app, connected", await until(() => page.url().endsWith("/m/connectors") && page.getByText("Gmail is connected ✓").isVisible(), 10_000), page.url());
    check("J …and the sign-in is there", !!S.vault.gmail.data.oauth?.tokens);
    // Comes back in another browser (iPhone home-screen app → Safari): held, confirmed there, finished by the app.
    S.oauthMode = "other";
    await page.goto(`${BASE}/m/connectors/calendar`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await until(() => page.getByText("came back in another browser").isVisible());
    await page.goto(`${BASE}/m/connectors`);
    check("J held, not confirmed yet: says what to tap", await until(() => page.getByText("Tap “Yes, it’s my account” on the page that opened, then come back.").isVisible(), 8000));
    S.flows[S.flows.length - 1].confirmed = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    check("J confirmed: the app finishes it", await until(() => page.getByText("Google Calendar is connected ✓").isVisible(), 8000) && !!S.vault.calendar.data.oauth?.tokens);
    S.oauthMode = "same";
    await page.goto(`${BASE}/m/connectors?error=denied&id=calendar`);
    check("J a refused sign-in in plain words", await until(() => page.getByText("The sign-in was cancelled.").isVisible()));
    // Add from the catalog.
    await page.goto(`${BASE}/m/connectors/add`);
    check("J the catalog: built-in and published, hidden left out", await until(async () => (await page.getByRole("button", { name: /GitHub/ }).count()) === 1 && (await page.getByRole("button", { name: /Zapier/ }).count()) === 1) && (await page.getByRole("button", { name: /^Make/ }).count()) === 0);
    await page.fill('input[type="search"]', "git");
    await page.getByRole("button", { name: /GitHub/ }).click();
    await page.getByRole("button", { name: "Add GitHub" }).click();
    check("J a needed key is asked for", await until(() => page.getByRole("alert").filter({ hasText: "Fill in “GitHub token”." }).isVisible()));
    await page.getByLabel("GitHub token").fill("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123");
    await page.getByRole("button", { name: "Add GitHub" }).click();
    check("J an AI model key is refused", await until(() => page.getByRole("alert").filter({ hasText: "AI model key" }).isVisible()));
    await page.getByLabel("GitHub token").fill("github_pat_standin");
    await page.getByRole("button", { name: "Add GitHub" }).click();
    check("J added: in the account, its key in the header, every bot (Mira, added above, too)", await until(() => S.vault.github?.data.headers?.Authorization === "Bearer github_pat_standin" && S.vault.github.data.bots.length === 6 && S.vault.github.data.catalogId === "github"));
    check("J …and its page opens", await until(() => page.url().endsWith("/m/connectors/github")));
    check("J the key never shown", !(await page.content()).includes("github_pat_standin"));
    await page.getByRole("button", { name: "Remove connector" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove connector" }).click();
    check("J remove: gone from the account", await until(() => !S.vault.github && page.url().endsWith("/m/connectors")));
    check("J still no secret anywhere on the phone", (await leaks()).length === 0, (await leaks()).join());

    // ---------- K) 320 px ----------
    await page.setViewportSize({ width: 320, height: 640 });
    const wide = [];
    for (const u of ["/m", "/m/c/dm-oovi", "/m/c/studio", "/m/c/dm-rex", "/m/archived", "/m/settings", "/m/connectors", "/m/connectors/gmail", "/m/connectors/add", "/m/offline"]) {
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
    check("L Arabic words", await page.locator(".m-nav__back", { hasText: "المحادثات" }).isVisible());
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
    check("B Check again brings the chats", await until(async () => (await page.locator(".m-chats > li").count()) >= 6));

    // ---------- M) offline ----------
    for (const u of ["/m", "/m/c/dm-oovi", "/m/archived", "/m/settings"]) {
      await page.goto(BASE + u);
      await sleep(400);
    }
    const sw = await until(() => page.evaluate(() => !!navigator.serviceWorker && !!navigator.serviceWorker.controller), 10_000);
    check("M the offline worker controls the app", sw);
    await ctx.setOffline(true);
    await page.goto(`${BASE}/m`).catch(() => {});
    check("M offline: the app opens with the saved chats", await until(async () => (await page.locator(".m-chats > li").count()) >= 6, 8000));
    check("M offline: said plainly", await page.getByText("You’re offline. Showing what this phone saved.").isVisible());
    await page.goto(`${BASE}/m/c/dm-oovi`).catch(() => {});
    check("M offline: a chat seen before opens", await until(() => page.locator(".m-md table").isVisible(), 8000));
    await ctx.setOffline(false);

    // ---------- Y) tap a face to edit the bot or group; the computer's chat tools (owner, 2026-11-19) ----------
    await page.goto(`${BASE}/m`);
    await until(() => page.locator(".m-chats").first().isVisible());
    await page.getByRole("link", { name: "Edit Rex" }).click();
    check("Y a bot's face in the list opens its editor", await until(() => page.url().endsWith("/m/bot/rex") && page.getByLabel("Role", { exact: true }).isVisible()));
    check("Y no model or key choice on the phone", (await page.getByText(/model|API key/i).count()) === 0);
    check("Y computer-wide abilities shown as 'On your computer'", (await page.getByText("Control this computer").isVisible()) && (await page.locator(".m-row.is-off", { hasText: "On your computer" }).count()) === 2);
    await page.getByLabel("Name", { exact: true }).fill("nova");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    check("Y a name another bot has is refused", await until(() => page.getByRole("alert").filter({ hasText: "not used by another bot" }).isVisible()) && S.items["bot:rex"].name === "Rex");
    await page.getByLabel("Name", { exact: true }).fill("Rex");
    await page.getByLabel("Role", { exact: true }).fill("Editor");
    await page.getByRole("switch", { name: "Web search" }).click();
    S.setupConflicts = 1;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    check("Y saved in the account's setup after a conflict: role, web search off, the rest kept", await until(() => S.items["bot:rex"].role === "Editor" && S.setupConflicts === 0) && S.items["bot:rex"].tools.web === false && S.items["bot:rex"].instructions === "SECRET-INSTRUCTIONS" && (await until(() => page.getByText(/Saved\. Your computer applies it/).isVisible())));
    await page.getByRole("tab", { name: "Your picture" }).click();
    const ypng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");
    await page.locator('.m-pickpic input[type="file"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: ypng });
    check("Y 'Your picture' goes to the account (POST /api/v1/avatars)", await until(() => Object.keys(S.avatars).length === 1));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    check("Y …and the bot's face uses it", await until(() => S.items["bot:rex"].face.image === Object.keys(S.avatars)[0]));
    await page.goto(`${BASE}/m/c/studio`);
    await page.getByRole("link", { name: "Edit Studio" }).click();
    check("Y a group's header opens the group editor", await until(() => page.url().endsWith("/m/group/studio") && page.getByLabel("Name", { exact: true }).isVisible()));
    await page.getByLabel("Name", { exact: true }).fill("Studio Team");
    await page.getByRole("checkbox", { name: /Rex/ }).click();
    await page.getByRole("radio", { name: /Nova/ }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    check("Y group saved: name, members, leader", await until(() => S.items["group:studio"].name === "Studio Team") && S.items["group:studio"].memberIds.join() === "oovi,nova" && S.items["group:studio"].leadId === "nova");
    const miraId = miraKey().slice(4);
    await page.goto(`${BASE}/m/bot/${miraId}`);
    await until(() => page.getByLabel("Role", { exact: true }).isVisible());
    await page.getByRole("switch", { name: "Hide from the bots list" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    check("Y hide a bot", await until(() => S.items[`bot:${miraId}`]?.hidden === true));
    await page.goto(`${BASE}/m`);
    await until(() => page.locator(".m-chats").first().isVisible());
    check("Y …it leaves the list", (await page.locator(".m-chat__name", { hasText: "Mira" }).count()) === 0);
    await page.getByRole("button", { name: "New chat" }).click();
    check("Y …and New chat still reaches it, under Hidden bots", await until(() => page.getByRole("dialog").getByText("Hidden bots").isVisible()) && (await page.getByRole("dialog").locator(".m-chat__name", { hasText: "Mira" }).count()) === 1);
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/m/bot/${miraId}`);
    await until(() => page.getByLabel("Role", { exact: true }).isVisible());
    await page.locator(".m-edbar").getByRole("button", { name: "Delete" }).click();
    check("Y delete a bot asks first", await until(() => page.getByRole("dialog").getByText(/Delete Mira\?/).isVisible()));
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    check("Y deleted from the account's setup, as the computer does", await until(() => !S.items[`bot:${miraId}`] && page.url().endsWith("/m")));

    await page.goto(`${BASE}/m/c/dm-oovi`);
    await until(() => page.locator(".m-bubble").first().isVisible());
    await page.getByRole("button", { name: "Chat options" }).click();
    const clearBtn = page.getByRole("dialog").getByRole("button", { name: /Clear conversation/ });
    check("Y the computer-only tools are shown, not hidden: clear, Canvas, live view, project folder", (await clearBtn.getAttribute("aria-disabled")) === "true" && (await page.getByRole("dialog").getByText("Canvas").isVisible()) && (await page.getByRole("dialog").getByText("Project folder").isVisible()));
    await page.getByRole("dialog").getByRole("button", { name: "Find in this chat" }).click();
    await page.getByRole("searchbox", { name: "Find in this chat" }).fill("friday");
    check("Y find in this chat", await until(async () => (await page.locator(".m-msg.is-found").count()) === 1 && (await page.locator(".m-find__n").textContent()).startsWith("1 of")));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Chat options" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog").getByRole("button", { name: "Download this chat (Markdown)" }).click()]);
    const md = fs.readFileSync(await dl.path(), "utf8");
    check("Y download this chat (Markdown), like the computer's", dl.suggestedFilename() === "Oovi.md" && md.startsWith("# Oovi\n") && md.includes("## You · ") && md.includes("Book it for Friday") && !md.includes("BIG TOOL RESULT"));
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pin to the top of the list" }).click();
    check("Y pin from the chat", await until(async () => (await page.evaluate(() => localStorage.getItem("oovi.m.pins") || "")).includes("dm-oovi")));
    await page.locator(".m-bubble--bot").last().click({ button: "right" });
    check("Y message: 'New chat from here', thumbs up/down shown as on your computer", await until(async () => (await page.getByRole("dialog").getByRole("button", { name: /New chat from here/ }).getAttribute("aria-disabled")) === "true" && (await page.getByRole("dialog").getByRole("button", { name: /Good reply/ }).count()) === 1));
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Plan/ }).click();
    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /How hard the bots think/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^High/ }).click();
    check("Y effort and plan shown above the box", await until(() => page.locator(".m-optsbar").getByText("Plan").isVisible()));
    const beforeY = jobsOf("message").length;
    await page.locator(".m-composer textarea").fill("Plan the trip");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    check("Y …and sent with the message (the computer runs it that way)", await until(() => jobsOf("message").length === beforeY + 1) && jobsOf("message").at(-1).payload.plan === true && jobsOf("message").at(-1).payload.effort === "high");
    await until(() => jobsOf("message").at(-1).status === "done", 10_000);
    await page.goto(`${BASE}/m/settings`);
    check("Y routines listed (read-only), when they run, 'On your computer'", await until(() => page.getByText("Morning digest").isVisible()) && (await page.getByText(/Mon, Wed, Fri at 08:30 · By Nova/).isVisible()));
    check("Y …the routine's prompt never reaches the phone", !(await page.content()).includes("SECRET-ROUTINE-PROMPT") && !(await page.evaluate(() => Object.values(localStorage).join("\n"))).includes("SECRET-ROUTINE-PROMPT"));
    check("Y Marketplace link", (await page.locator('a[href="/experts"]').count()) === 1);

    // ---------- W) the web version (/app): same app, two columns, keyboard, desktop suggestion ----------
    {
      const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
      await wctx.addCookies([{ name: "standin", value: "1", url: BASE }]);
      const w = await wctx.newPage();
      const werr = [];
      w.on("pageerror", (e) => werr.push(e.message));
      await w.goto(`${BASE}/app`);
      check("W web: the sidebar like the computer's (Groups, Bots), a welcome on the right", await until(async () => (await w.locator(".m-pane--list .m-chats > li").count()) >= 4 && (await w.getByText("Pick a chat").isVisible()) && (await w.locator("#list-groups").isVisible()) && (await w.locator("#list-bots").isVisible())));
      check("W …with + Group and + Bot at the top", (await w.locator(".m-pane--list").getByRole("button", { name: "Group", exact: true }).isVisible()) && (await w.locator(".m-pane--list").getByRole("button", { name: "Bot", exact: true }).isVisible()));
      const card = w.locator(".m-desk--list");
      check("W the desktop app suggested gently in the list, with the download page", (await card.isVisible()) && (await card.locator("a").getAttribute("href")) === "/download");
      await card.getByRole("button", { name: "Hide this" }).click();
      await w.reload();
      await until(() => w.locator(".m-pane--list .m-chats").first().isVisible());
      check("W hidden for good once hidden", (await w.locator(".m-desk--list").count()) === 0);
      await w.locator('.m-pane--list a[href="/app/c/dm-oovi"]').click();
      check("W a chat opens beside the list", await until(async () => w.url().endsWith("/app/c/dm-oovi") && (await w.locator(".m-pane--main .m-md table").isVisible()) && (await w.locator(".m-pane--list .m-chats").first().isVisible())));
      check("W its row is marked open", (await w.locator('.m-pane--list a[aria-current="page"]').getAttribute("href")) === "/app/c/dm-oovi");
      await w.locator(".m-pane--list").getByRole("link", { name: "Edit Nova" }).click();
      check("W a face in the sidebar opens the bot's editor beside the list", await until(() => w.url().endsWith("/app/bot/nova") && w.locator(".m-pane--main").getByLabel("Role", { exact: true }).isVisible()));
      await w.goto(`${BASE}/app/c/dm-oovi`);
      await until(() => w.locator(".m-pane--main .m-md table").isVisible());
      check("W a bot's message: name, role and time above it, like on the computer", await w.locator(".m-pane--main .m-msg__who").first().textContent().then((x) => x.includes("Oovi")));
      const wbox = w.locator(".m-pane--main .m-composer textarea");
      await wbox.click();
      await wbox.type("Line one");
      await w.keyboard.press("Shift+Enter");
      await wbox.type("line two");
      check("W Shift+Enter: a new line", (await wbox.inputValue()) === "Line one\nline two");
      const before = jobsOf("message").length;
      await w.keyboard.press("Enter");
      check("W Enter sends", await until(() => jobsOf("message").length === before + 1 && jobsOf("message").at(-1).payload.text === "Line one\nline two"));
      await until(() => jobsOf("message").at(-1).status === "done", 10_000);
      await w.locator(".m-pane--main").click({ position: { x: 300, y: 120 } });
      await w.keyboard.press("Escape");
      check("W Esc closes the chat", await until(() => w.url().endsWith("/app") && w.getByText("Pick a chat").isVisible()));
      await w.goto(`${BASE}/app/c/dm-rex`);
      const line = w.locator(".m-card--computer .m-desk--line");
      check("W 'needs your computer' says what the desktop app does, with Download", await until(() => line.isVisible()) && (await line.textContent()).includes("it works on your files") && (await line.locator("a").getAttribute("href")) === "/download");
      await w.locator(".m-pane--list").getByRole("link", { name: "Your profile and settings" }).click();
      check("W the profile picture opens Settings beside the list: this browser, the desktop app section", await until(() => w.url().endsWith("/app/settings") && w.locator(".m-pane--main").getByText("This browser").isVisible()) && (await w.locator(".m-pane--main .m-desk--card").isVisible()) && (await w.locator(".m-pane--list .m-chats").first().isVisible()));
      await w.locator('.m-pane--main a[href="/app/connectors"]').click();
      check("W connectors open beside the list", await until(async () => (await w.locator(".m-pane--main .m-row--conn").count()) === 4 && (await w.locator(".m-pane--list .m-chats").first().isVisible())));
      check("W no sideways scroll at 1440 px", (await w.evaluate(() => document.documentElement.scrollWidth)) <= 1440);
      check("W no page errors", werr.length === 0, werr.join(" | "));
      await wctx.close();
      const octx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const o = await octx.newPage();
      await o.goto(`${BASE}/app/settings`);
      check("W signed out: the website's sign-in page, then back here", await until(() => o.url().includes("/login?next=%2Fapp%2Fsettings"), 10_000), o.url());
      await octx.close();
    }

    // ---------- N) another account on the same phone, then sign out ----------
    await page.goto(`${BASE}/m`);
    await page.evaluate(() => {
      localStorage.setItem("oovi.m.me", JSON.stringify({ id: "someone-else", name: "Other", email: "other@example.test", image: null }));
      const c = JSON.parse(localStorage.getItem("oovi.m.chats"));
      c.chats["old-account-chat"] = { version: 1, chat: { id: "old-account-chat", kind: "group", name: "Previous account's chat", memberIds: [], createdAt: 1, updatedAt: Date.now(), entries: [{ id: "x", kind: "user", text: "private", at: Date.now() }] } };
      localStorage.setItem("oovi.m.chats", JSON.stringify(c));
    });
    await page.reload();
    check("N another account signed in: the previous account's chats are wiped", await until(async () => (await page.getByText("Previous account's chat").count()) === 0 && (await page.locator(".m-chats > li").count()) >= 6 && !(await page.evaluate(() => localStorage.getItem("oovi.m.chats") || "")).includes("old-account-chat")));

    await page.goto(`${BASE}/m/settings`);
    await page.getByRole("button", { name: "Sign out" }).click();
    check("N sign out asks first", await page.getByRole("dialog").getByText(/Sign out of oovi on this phone\?/).isVisible());
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    check("N signed out: back to sign-in", await until(() => page.url().includes("/m/login")));
    check("N the phone's copy is gone", (await page.evaluate(() => localStorage.getItem("oovi.m.chats"))) === null);

    // ---------- X) the website after sign-in: the web app, and the account page inside its Settings ----------
    {
      const xctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
      const x = await xctx.newPage();
      const xerr = [];
      x.on("pageerror", (e) => xerr.push(e.message));
      S.signedIn = false;
      await x.goto(`${BASE}/login`);
      await x.fill("#email", "phone.tester@example.test");
      await x.fill("#password", "standin-pass");
      await x.click('button[type="submit"]');
      check("X the website's sign-in lands on the web app (/app)", await until(() => x.url().endsWith("/app") && x.locator(".m-pane--list .m-chats").first().isVisible(), 15_000), x.url());
      await x.goto(`${BASE}/`);
      check("X signed in, the site's button says Open oovi → /app", await until(async () => (await x.locator(".nav-login").textContent()) === "Open oovi" && (await x.locator(".nav-login").getAttribute("href")) === "/app"));
      await x.goto(`${BASE}/account`);
      check("X /account goes to the web app's Settings", await until(() => x.url().endsWith("/app/settings") && x.locator(".m-pane--main").getByText("Manage billing").isVisible(), 15_000), x.url());
      await x.goto(`${BASE}/account?billing=none`);
      check("X …keeping Paddle's way back (?billing=none) and saying it", await until(() => x.url().endsWith("/app/settings?billing=none") && x.getByText(/couldn’t find a subscription/).isVisible()));
      check("X Settings: subscription status and the confirm-email reminder", await until(async () => (await x.locator(".m-pane--main").getByText("Active", { exact: true }).isVisible()) && (await x.getByText("Confirm your email").isVisible())));
      await x.getByRole("button", { name: "Send it again" }).click();
      check("X confirm email: sent again", await until(() => S.verifySent === 1 && x.getByText(/Sent\. Check your inbox/).isVisible()));
      await x.getByRole("button", { name: /Manage billing/ }).click();
      check("X Manage billing opens Paddle's portal (the website's route, from Settings)", await until(() => x.url().endsWith("/__paddle/portal") && S.portalOpened === 1));
      S.account.billing = null;
      await x.goto(`${BASE}/app/settings`);
      check("X no subscription: the free plan and See plans", await until(() => x.getByText("You’re on the free plan.", { exact: false }).isVisible()) && (await x.locator('.m-pane--main a[href="/pricing"]').isVisible()));
      await x.locator('.m-pane--main a[href="/app/settings/account"]').first().click();
      check("X Account opens beside the list", await until(() => x.url().endsWith("/app/settings/account") && x.locator(".m-pane--main").getByText("Delete account").first().isVisible()));
      const nameBox = x.getByLabel("Name", { exact: true });
      await nameBox.fill("Sam Writer");
      await x.getByRole("button", { name: "Save", exact: true }).click();
      check("X name saved (the website's PATCH /api/v1/me)", await until(() => sb.state && x.getByText("Saved.").isVisible()) && (await x.evaluate(() => JSON.parse(localStorage.getItem("oovi.m.me") || "{}").name)) === "Sam Writer");
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");
      await x.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
      check("X photo uploaded, shown at once (also in the sidebar)", await until(async () => (await x.getByText("Profile photo updated.").isVisible()) && (await x.locator(".m-pane--list .m-profile img").count()) === 1));
      await x.getByRole("button", { name: "Remove photo" }).click();
      check("X photo removed", await until(async () => (await x.getByText("Profile photo removed.").isVisible()) && (await x.locator(".m-pane--list .m-profile img").count()) === 0));
      await x.getByLabel("Current password").fill("not-it-at-all");
      await x.getByLabel("New password").fill("new-pass-123");
      await x.getByRole("button", { name: "Change password" }).click();
      check("X password: a wrong current one is refused", await until(() => x.getByText("Your current password is incorrect.").isVisible()) && S.password === "standin-pass");
      await x.getByLabel("Current password").fill("standin-pass");
      await x.getByLabel("New password").fill("short");
      await x.getByRole("button", { name: "Change password" }).click();
      check("X password: too short is refused here", await until(() => x.getByText("at least 8 characters").isVisible()) && S.password === "standin-pass");
      await x.getByLabel("New password").fill("new-pass-123");
      await x.getByRole("button", { name: "Change password" }).click();
      check("X password changed, other devices signed out", await until(() => x.getByText(/Password changed/).isVisible()) && S.password === "new-pass-123" && S.pwChanges.at(-1)?.revokeOtherSessions === true);
      await x.getByRole("switch", { name: "News by email" }).click();
      check("X news by email: off", await until(() => S.account.news === false));
      await x.getByRole("button", { name: "Delete account" }).click();
      await x.getByLabel("Enter your password to confirm").fill("standin-pass");
      await x.getByRole("button", { name: "Permanently delete my account" }).click();
      check("X delete: the password is asked (a wrong one is refused)", await until(() => x.getByText("That password is incorrect.").isVisible()) && !S.accountDeleted);
      check("X no page errors on the account screens", xerr.length === 0, xerr.join(" | "));

      // The web version on a narrow window: one column, the sidebar look, then the chat with a back button.
      await x.setViewportSize({ width: 390, height: 844 });
      await x.goto(`${BASE}/app`);
      check("X narrow /app: one column, the web app's look (logo, picture, + Group / + Bot)", await until(async () => (await x.locator(".m-sidehead").isVisible()) && (await x.locator(".m-pane").count()) === 0 && (await x.locator(".m-adds").isVisible())));
      await x.locator('a[href="/app/c/dm-oovi"]').first().click();
      check("X narrow /app: the chat fills the window, with a back button", await until(() => x.url().endsWith("/app/c/dm-oovi") && x.locator(".m-nav__back").isVisible()));
      await x.setViewportSize({ width: 320, height: 640 });
      const xw = [];
      for (const u of ["/app", "/app/settings", "/app/settings/account"]) {
        await x.goto(BASE + u);
        await sleep(700);
        const w = await x.evaluate(() => document.documentElement.scrollWidth);
        if (w > 320) xw.push(`${u}=${w}`);
      }
      check("X no sideways scroll at 320 px on the web app and its account screens", xw.length === 0, xw.join(" "));
      await x.getByRole("button", { name: "Delete account" }).click();
      await x.getByLabel("Enter your password to confirm").fill("new-pass-123");
      await x.getByRole("button", { name: "Permanently delete my account" }).click();
      check("X delete account: done, the browser's copy wiped, back to the home page", await until(() => S.accountDeleted && x.url().endsWith("/?deleted=1")) && (await x.evaluate(() => localStorage.getItem("oovi.m.chats"))) === null);
      await xctx.close();
    }
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
        // The chat screens keep a long-poll open, so "network idle" never comes: wait for the screen itself.
        await page.locator(".m-screen").first().waitFor({ timeout: 8000 }).catch(() => {});
        await sleep(1200);
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
      await shot("new-bot", "/m", async (p) => {
        await p.locator(".m-adds .m-btn").nth(1).click();
        await sleep(500);
      });
      await shot("settings", "/m/settings");
      await shot("account", "/m/settings/account");
      await shot("bot-editor", "/m/bot/nova");
      await shot("bot-editor-look", "/m/bot/nova", async (p) => {
        await p.getByRole("tab").nth(3).click();
        await p.locator(".m-lookpanel").scrollIntoViewIfNeeded();
        await sleep(300);
      });
      await shot("group-editor", "/m/group/studio");
      await shot("chat-menu", "/m/c/dm-oovi", async (p) => {
        await p.locator(".m-nav__more").click();
        await sleep(500);
      });
      await shot("connectors", "/m/connectors");
      await shot("connector", "/m/connectors/gmail");
      await shot("connector-add", "/m/connectors/add");
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
      // The web version, 1440 × 900.
      const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang === "ar" ? "ar-DZ" : "en-US", colorScheme: scheme });
      await wctx.addCookies([{ name: "standin", value: "1", url: BASE }]);
      await wctx.addInitScript(([l]) => {
        if (!localStorage.getItem("oovi.m.prefs")) localStorage.setItem("oovi.m.prefs", JSON.stringify({ lang: l, theme: "auto" }));
        if (!localStorage.getItem("oovi.m.seen")) localStorage.setItem("oovi.m.seen", JSON.stringify({ "dm-oovi": Date.now(), "dm-nova": Date.now(), "dm-rex": Date.now(), "dm-lina": Date.now(), studio: 0 }));
      }, [lang]);
      const wp = await wctx.newPage();
      for (const [name, url] of [["chat", "/app/c/dm-oovi"], ["group", "/app/c/studio"], ["chats", "/app"], ["needs-computer", "/app/c/dm-rex"], ["settings", "/app/settings"], ["account", "/app/settings/account"], ["bot-editor", "/app/bot/nova"], ["group-editor", "/app/group/studio"], ["connectors", "/app/connectors"]]) {
        await wp.goto(BASE + url);
        await wp.locator(".m-wide").first().waitFor({ timeout: 8000 }).catch(() => {});
        await sleep(1300);
        const file = path.join(SHOT_DIR, `web-${lang}-${scheme}-${name}.jpg`);
        await wp.screenshot({ path: file, type: "jpeg", quality: 82 });
        written.push(path.relative(ROOT, file));
      }
      // The web version on a narrow window (a phone's browser): one column, the web app's look.
      await wp.setViewportSize({ width: 390, height: 844 });
      for (const [name, url] of [["chats", "/app"], ["chat", "/app/c/dm-oovi"]]) {
        await wp.goto(BASE + url);
        await wp.locator(".m-screen").first().waitFor({ timeout: 8000 }).catch(() => {});
        await sleep(1300);
        const file = path.join(SHOT_DIR, `web-narrow-${lang}-${scheme}-${name}.jpg`);
        await wp.screenshot({ path: file, type: "jpeg", quality: 82 });
        written.push(path.relative(ROOT, file));
      }
      await wctx.close();
    }
  }
  console.log(`screenshots: ${written.length} written in docs/mobile/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
