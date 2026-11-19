// Makes the native apps' icons and launch screens from the oovi logo (same source as web/scripts/mobile-icons.cjs),
// and writes www/offline.html with the logo inlined (the offline page must not load anything).
// Uses the pre-installed Playwright browser. Run from the repository root: node mobile/scripts/native-icons.cjs
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "..");
const mobile = path.join(root, "mobile");
const res = path.join(mobile, "android", "app", "src", "main", "res");
const ios = path.join(mobile, "ios", "App", "App", "Assets.xcassets");
const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const logo = dataUri(path.join(root, "build", "icon.png"));
const mark = dataUri(path.join(root, "web", "public", "mark.png")); // the logo without the icon's white tile
const logoDark = dataUri(path.join(root, "web", "public", "mark-dark.png"));
const PAPER = "#FBFAF7";
const PAPER_DARK = "#151513";

const page = (bg, img, pct) =>
  `<html><body style="margin:0;width:100vw;height:100vh;display:grid;place-items:center;background:${bg}"><img src="${img}" style="width:${pct}%;height:auto"></body></html>`;
// A white disc with the logo, on a transparent page (the legacy round launcher icon).
const disc = (img, pct) =>
  `<html><body style="margin:0;background:transparent"><div style="width:100vw;height:100vh;border-radius:50%;background:#FFFFFF;display:grid;place-items:center"><img src="${img}" style="width:${pct}%;height:auto"></div></body></html>`;

// Android densities: launcher icon 48dp, adaptive layer 108dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const browser = await chromium.launch();
  const shot = async (w, h, html, file, transparent = false) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.setContent(html);
    await p.waitForLoadState("load");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: transparent });
    await ctx.close();
  };

  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = path.join(res, `mipmap-${d}`);
    const icon = Math.round(48 * k);
    const layer = Math.round(108 * k);
    await shot(icon, icon, page("#FFFFFF", logo, 84), path.join(dir, "ic_launcher.png"));
    await shot(icon, icon, disc(logo, 72), path.join(dir, "ic_launcher_round.png"), true);
    // Adaptive icon: the logo inside the 66dp safe zone of the 108dp layer, on white (ic_launcher_background).
    await shot(layer, layer, page("transparent", logo, 56), path.join(dir, "ic_launcher_foreground.png"), true);
  }
  // Launch screen logo (Android): shown centred on paper by drawable/splash.xml, light and dark.
  await shot(288, 288, page("transparent", mark, 100), path.join(res, "drawable-nodpi", "splash_logo.png"), true);
  await shot(288, 288, page("transparent", logoDark, 100), path.join(res, "drawable-night-nodpi", "splash_logo.png"), true);

  // iOS: the App Store icon (no transparency) and the launch image, light and dark.
  await shot(1024, 1024, page("#FFFFFF", logo, 84), path.join(ios, "AppIcon.appiconset", "AppIcon-512@2x.png"));
  const S = 2732;
  await shot(S, S, page(PAPER, mark, (330 / S) * 100), path.join(ios, "Splash.imageset", "splash-2732x2732.png"));
  await shot(S, S, page(PAPER, mark, (330 / S) * 100), path.join(ios, "Splash.imageset", "splash-2732x2732-1.png"));
  await shot(S, S, page(PAPER_DARK, logoDark, (330 / S) * 100), path.join(ios, "Splash.imageset", "splash-2732x2732-2.png"));
  await browser.close();

  // Offline page with the logo inlined (small copies).
  const small = async (src) => {
    const b2 = await chromium.launch();
    const ctx = await b2.newContext({ viewport: { width: 176, height: 176 } });
    const p = await ctx.newPage();
    await p.setContent(page("transparent", src, 100));
    const buf = await p.screenshot({ omitBackground: true });
    await b2.close();
    return `data:image/png;base64,${buf.toString("base64")}`;
  };
  const html = fs
    .readFileSync(path.join(mobile, "src", "offline.html"), "utf8")
    .replace("__LOGO__", await small(mark))
    .replace("__LOGO_DARK__", await small(logoDark));
  fs.writeFileSync(path.join(mobile, "www", "offline.html"), html);
  console.log("native icons, launch screens and www/offline.html written");
})();
