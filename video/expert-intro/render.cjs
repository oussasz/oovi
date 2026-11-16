// Renders scene.html to an MP4, frame by frame (every frame is a pure function of time, so it never drifts).
// Usage: node render.cjs experts/abdelaziz.json out/abdelaziz.mp4 [--fps 30] [--at 4.5,9,15]   (--at = only save still PNGs at those seconds)
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [cfgPath, outPath = "out/video.mp4", ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const FPS = Number(opt("--fps", 30));
const AT = opt("--at", "");
const SIZE = Number(opt("--size", 1080));
const audio = opt("--audio", "");

(async () => {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: SIZE / 1080 });
  await page.addInitScript((c) => { window.CONFIG = c; }, cfg);
  await page.goto("file://" + path.resolve(__dirname, "scene.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const dur = await page.evaluate(() => window.DURATION);

  if (AT) {
    for (const s of AT.split(",")) {
      await page.evaluate((t) => window.seek(t), Number(s));
      await page.screenshot({ path: path.join(path.dirname(outPath), `still-${s}.png`) });
    }
    await b.close(); return;
  }
  const frames = Math.round(dur * FPS);
  const args = ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"];
  if (audio) args.push("-i", audio);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", "-movflags", "+faststart");
  if (audio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outPath);
  const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "inherit"] });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  await b.close();
  console.log(`${outPath}: ${frames} frames, ${dur}s at ${FPS} fps`);
})();
