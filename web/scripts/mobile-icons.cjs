// Makes the phone app's icons and iPhone launch screens (web/public/m/) from the oovi logo, with the
// pre-installed Playwright browser. Run from the repository root: node web/scripts/mobile-icons.cjs
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "..");
const out = path.join(root, "web", "public", "m");
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "build", "icon.png")).toString("base64")}`;
const logoDark = `data:image/png;base64,${fs.readFileSync(path.join(root, "web", "public", "mark-dark.png")).toString("base64")}`;
// Same list as web/app/m/_lib/splash.ts
const SPLASH = [[375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3], [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3]];

const page = (bg, img, pct) =>
  `<html><body style="margin:0;width:100vw;height:100vh;display:grid;place-items:center;background:${bg}"><img src="${img}" style="width:${pct}%;height:auto"></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const shot = async (w, h, dpr, html, file) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.setContent(html);
    await p.waitForLoadState("load");
    await p.screenshot({ path: path.join(out, file) });
    await ctx.close();
  };
  const BG = "#FFFFFF";
  await shot(192, 192, 1, page(BG, logo, 84), "icon-192.png");
  await shot(512, 512, 1, page(BG, logo, 84), "icon-512.png");
  // Maskable: the logo inside the 80% safe circle.
  await shot(512, 512, 1, page(BG, logo, 66), "icon-maskable-512.png");
  await shot(180, 180, 1, page(BG, logo, 82), "apple-touch-icon.png");
  for (const [w, h, dpr] of SPLASH) {
    const pct = (110 / w) * 100;
    await shot(w, h, dpr, page("#FFFFFF", logo, pct), path.join("splash", `${w * dpr}x${h * dpr}.png`));
    await shot(w, h, dpr, page("#000000", logoDark, pct), path.join("splash", `${w * dpr}x${h * dpr}-dark.png`));
  }
  await browser.close();
  console.log("icons and launch screens written to", out);
})();
