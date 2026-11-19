// The website's side of oovi's phone apps, against the BUILT website (web/: run `npm run build` there first) behind
// the stand-in cloud API (tests/e2e/mobile-standin.cjs), and the offline page built into the app
// (mobile/www/offline.html, written by mobile/scripts/native-icons.cjs). Nothing leaves this machine except, in D,
// the website's usual read of the public releases list on GitHub. Checked:
//   A) /download: the desktop chooser and the phone card ("Download for Android" → /download/android,
//      "iPhone: coming soon"); on an Android phone the phone card comes first,
//   B) /m in Chrome on Android: "Get the Android app" in the chat list (in place of the desktop card), hidden for
//      good with ×; Settings offers "Get the Android app" instead of "Add to Home Screen",
//   C) /m inside oovi's app (user agent "ooviApp/1.0"): no Android card, no "Add to Home Screen"; the phone's Back
//      ("ooviback") closes an open sheet and is left to the app when nothing is open,
//   D) /download/android is a download target (never a 404),
//   E) the offline page: ar/fr/en from the app's saved language or the phone's, light/dark, "Try again" goes back
//      to the page that failed, never to another site, and nothing is loaded from the network.
// With --shots, writes screenshots in docs/android/.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium, devices } = require("playwright");
const { startStandin } = require("./mobile-standin.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "web");
const NEXT_PORT = 3482;
const PORT = 3481;
const OFF_PORT = 3483;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(ROOT, "docs", "android");
const { defaultBrowserType: _a, ...PIXEL } = devices["Pixel 7"];
const NATIVE_UA = `${PIXEL.userAgent.replace("Chrome/", "Version/4.0 Chrome/")} ooviApp/1.0`;

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
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: "jpeg", quality: 82, fullPage: name.startsWith("download") });
};

async function signedIn(browser, ua, extra = {}) {
  const ctx = await browser.newContext({ ...PIXEL, userAgent: ua, locale: "en-US", ...extra });
  await ctx.addCookies([{ name: "standin", value: "1", url: BASE }]);
  return ctx;
}

async function main() {
  if (!fs.existsSync(path.join(WEB, ".next", "BUILD_ID"))) {
    console.error("Build the website first: cd web && npm run build");
    process.exit(2);
  }
  const next = spawn(process.execPath, [path.join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(NEXT_PORT), "-H", "127.0.0.1"], { cwd: WEB, stdio: "ignore" });
  process.on("exit", () => next.kill());
  const up = await until(async () => (await fetch(`http://127.0.0.1:${NEXT_PORT}/m/manifest.webmanifest`)).ok, 60_000, 300);
  if (!up) throw new Error("the website did not start");
  const sb = await startStandin({ port: PORT, nextPort: NEXT_PORT, lang: "en", replyDelayMs: 500 });
  sb.state.sync = true;
  sb.state.signedIn = true;
  const browser = await chromium.launch();
  try {
    // ---------- A) the download page ----------
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
    let page = await ctx.newPage();
    await page.goto(`${BASE}/download`);
    const cards = page.locator(".dl-cards > .card");
    await until(async () => (await cards.count()) === 2);
    check("A two cards: computer and phone", (await cards.count()) === 2);
    check("A on a computer the desktop chooser comes first", (await cards.first().locator(".seg").count()) === 1);
    const android = page.getByRole("link", { name: /Download for Android \(APK\)/ });
    check("A 'Download for Android' points to /download/android", (await android.getAttribute("href")) === "/download/android");
    check("A 'iPhone: coming soon'", await page.getByText("iPhone: coming soon").isVisible());
    check("A the install steps mention Install unknown apps", (await page.locator("#phone").innerText()).includes("install unknown apps"));
    check("A it says it's a direct download for now", (await page.locator("#phone").innerText()).includes("Direct download for now"));
    await shot(page, "download-desktop");
    await ctx.close();
    ctx = await browser.newContext({ ...PIXEL, deviceScaleFactor: SHOTS ? 2 : PIXEL.deviceScaleFactor });
    page = await ctx.newPage();
    await page.goto(`${BASE}/download`);
    check("A on an Android phone the phone card comes first", await until(async () => (await page.locator(".dl-cards > .card").first().locator("#phone").count()) === 1));
    check("A no sideways scroll on the phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await shot(page, "download-phone");
    await ctx.close();
    for (const [locale, words, dir] of [["fr-FR", "Télécharger pour Android (APK)", "ltr"], ["ar-DZ", "نزّل لأندرويد (APK)", "rtl"]]) {
      ctx = await browser.newContext({ ...PIXEL, locale, deviceScaleFactor: SHOTS ? 2 : PIXEL.deviceScaleFactor });
      page = await ctx.newPage();
      await page.goto(`${BASE}/download`);
      check(`A ${locale}: the phone card in the visitor's language`, await until(async () => (await page.locator("#phone").innerText()).includes(words)));
      check(`A ${locale}: direction ${dir}`, (await page.locator("#phone").getAttribute("dir")) === dir);
      if (dir === "rtl") await shot(page, "download-phone-ar");
      await ctx.close();
    }
    ctx = await browser.newContext({ ...PIXEL, userAgent: NATIVE_UA });
    page = await ctx.newPage();
    await page.goto(`${BASE}/download`);
    await page.locator(".dl-cards .seg").waitFor({ timeout: 8000 });
    await sleep(500);
    check("A inside oovi's app: no phone card (no APK text in the app)", (await page.locator("#phone").count()) === 0);
    await ctx.close();

    // ---------- B) /m in Chrome on Android ----------
    ctx = await signedIn(browser, PIXEL.userAgent);
    page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/m`);
    const card = page.locator("aside.m-desk", { hasText: "Get the Android app" });
    check("B the chat list suggests the Android app", await until(() => card.isVisible(), 10_000));
    check("B ... in place of the desktop card", (await page.locator("aside.m-desk", { hasText: "oovi on your computer" }).count()) === 0);
    check("B its button opens the download page at the phone card", (await card.getByRole("link").getAttribute("href")) === "/download#phone");
    await shot(page, "m-android-card");
    await card.getByRole("button", { name: "Hide this" }).click();
    check("B × hides it", await until(async () => (await card.count()) === 0));
    await page.reload();
    await page.locator(".m-chats > li").first().waitFor({ timeout: 10_000 });
    await sleep(500);
    check("B ... for good", (await card.count()) === 0);
    await page.goto(`${BASE}/m/settings`);
    await page.getByText("Get the Android app").first().waitFor({ timeout: 10_000 }).catch(() => {});
    check("B Settings: 'Get the Android app'", await page.getByText("Get the Android app").first().isVisible());
    check("B Settings: no 'Add to Home Screen' on Android", (await page.getByText("Add to Home Screen").count()) === 0);
    check("B no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    // ---------- C) /m inside oovi's app ----------
    ctx = await signedIn(browser, NATIVE_UA);
    page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/m`);
    await page.locator(".m-chats > li").first().waitFor({ timeout: 10_000 });
    await sleep(600);
    check("C in the app: no Android card", (await page.locator("aside.m-desk", { hasText: "Get the Android app" }).count()) === 0);
    await page.goto(`${BASE}/m/settings`);
    await page.getByText("Language").first().waitFor({ timeout: 10_000 });
    await sleep(400);
    check("C in the app: no 'Add to Home Screen'", (await page.getByText("Add to Home Screen").count()) === 0);
    check("C in the app: no 'Get the Android app'", (await page.getByText("Get the Android app").count()) === 0);
    const back = () => page.evaluate(() => {
      const e = new CustomEvent("ooviback", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    check("C Back with nothing open is left to the app", (await back()) === false);
    await page.getByText("Language").first().click();
    check("C the language sheet opens", await until(() => page.locator('[role="dialog"]').isVisible()));
    check("C Back closes the sheet (and is not passed on)", (await back()) === true);
    check("C ... the sheet is gone", await until(async () => (await page.locator('[role="dialog"]').count()) === 0));
    check("C ... still on Settings", page.url().endsWith("/m/settings"));
    check("C Settings links the privacy policy (stores ask for it in the app)", (await page.getByRole("link", { name: "Privacy policy" }).getAttribute("href")) === "/privacy");
    check("C ... and the terms", (await page.getByRole("link", { name: "Terms" }).getAttribute("href")) === "/terms");
    check("C no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    // ---------- D) /download/android ----------
    const res = await fetch(`${BASE}/download/android`, { redirect: "manual" });
    const loc = res.headers.get("location") || "";
    check("D /download/android is a download (a file, or the 'not available' notice while no APK is published)", res.status === 302 && (/\.apk|githubusercontent|github\.com/.test(loc) || loc.includes("/download?error=unavailable")), `${res.status} ${loc}`);
    const bogus = await fetch(`${BASE}/download/iphone`, { redirect: "manual" });
    check("D an unknown target still lands on the download page", (bogus.headers.get("location") || "").includes("/download?error=unavailable"));

    // ---------- E) the offline page built into the app ----------
    const offline = fs.readFileSync(path.join(ROOT, "mobile", "www", "offline.html"), "utf8");
    check("E the logo is inlined (no file or network address in the page)", !/(src|href)="(https?:|\/)/.test(offline) && offline.includes("data:image/png;base64,"));
    const requests = [];
    const srv = http.createServer((req, resp) => {
      requests.push(req.url);
      if (req.url === "/offline.html") {
        resp.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        resp.end(offline);
      } else {
        resp.writeHead(200, { "Content-Type": "text/html" });
        resp.end(`<title>page</title><p id="where">${req.url}</p>`);
      }
    });
    await new Promise((r) => srv.listen(OFF_PORT, "127.0.0.1", r));
    const OFF = `http://127.0.0.1:${OFF_PORT}`;
    try {
      for (const [lang, title, locale] of [["en", "Can’t reach oovi", "en-US"], ["fr", "Impossible de joindre oovi", "fr-FR"], ["ar", "تعذّر الوصول إلى oovi", "ar-DZ"]]) {
        for (const scheme of ["light", "dark"]) {
          ctx = await browser.newContext({ ...PIXEL, locale, colorScheme: scheme, deviceScaleFactor: SHOTS ? 2 : PIXEL.deviceScaleFactor });
          page = await ctx.newPage();
          await page.goto(`${OFF}/offline.html#%2Fm%2Fc%2Fabc`);
          const h1 = await page.locator("h1").innerText();
          check(`E ${lang}/${scheme}: the title in the phone's language`, h1 === title, h1);
          if (lang === "ar") check("E Arabic is right to left", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
          const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          check(`E ${lang}/${scheme}: paper color`, bg === (scheme === "dark" ? "rgb(21, 21, 19)" : "rgb(251, 250, 247)"), bg);
          if (lang !== "fr") await shot(page, `offline-${lang}-${scheme}`);
          await ctx.close();
        }
      }
      // The app's own language choice beats the phone's.
      ctx = await browser.newContext({ ...PIXEL, locale: "en-US" });
      await ctx.addInitScript(() => localStorage.setItem("oovi.m.prefs", JSON.stringify({ lang: "fr", theme: "dark" })));
      page = await ctx.newPage();
      await page.goto(`${OFF}/offline.html`);
      check("E the app's saved language (French) wins over the phone's", (await page.locator("h1").innerText()) === "Impossible de joindre oovi");
      check("E the app's saved look (dark) wins over the phone's", (await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(21, 21, 19)");
      await ctx.close();
      // Try again: back to the page that failed; never another site.
      ctx = await browser.newContext({ ...PIXEL });
      page = await ctx.newPage();
      const tryAgain = async (hash) => {
        await page.goto(`${OFF}/offline.html${hash}`);
        await page.getByRole("button").click();
        await page.waitForURL((u) => !u.pathname.endsWith("/offline.html"), { timeout: 5000 }).catch(() => {});
        return new URL(page.url());
      };
      let u = await tryAgain("#%2Fm%2Fc%2Fabc%3Fx%3D1");
      check("E Try again opens the page that failed", u.pathname === "/m/c/abc" && u.search === "?x=1" && u.host === `127.0.0.1:${OFF_PORT}`, page.url());
      u = await tryAgain("#%2F%2Fevil.example%2Fm");
      check("E a hash pointing to another site goes to /m instead", u.pathname === "/m" && u.host === `127.0.0.1:${OFF_PORT}`, page.url());
      u = await tryAgain("#https%3A%2F%2Fevil.example%2F");
      check("E a full address in the hash goes to /m instead", u.pathname === "/m" && u.host === `127.0.0.1:${OFF_PORT}`, page.url());
      u = await tryAgain("#%2Fdownload");
      check("E a website page that isn't the app goes to /m instead", u.pathname === "/m", page.url());
      u = await tryAgain("");
      check("E no hash: /m", u.pathname === "/m", page.url());
      await ctx.close();
      check("E the offline page asked the network for nothing but itself and the retried pages", requests.every((r) => r.startsWith("/offline.html") || r.startsWith("/m")), requests.join(","));
    } finally {
      srv.close();
    }
  } finally {
    await browser.close();
    sb.close?.();
    next.kill();
  }
  console.log(`\nnative web scenario: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
