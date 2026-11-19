// Lighthouse on the phone app (PWA, accessibility, best practices) against the built website behind the
// stand-in API (tests/e2e/mobile-standin.cjs), signed in with the stand-in's cookie. Lighthouse is not a
// dependency of the project: it runs with `npx lighthouse@11.7.1` (the last version with the PWA checks),
// or the one named in LIGHTHOUSE. Fails when a score is under the bar below.
//   node tests/e2e/mobile-lighthouse.cjs        (web/ must be built first)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { startStandin } = require("./mobile-standin.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const WEB = path.join(ROOT, "web");
const NEXT_PORT = 3482;
const PORT = 3481;
const BAR = { pwa: 0.9, accessibility: 0.95, "best-practices": 0.9 };
const PAGES = ["/m", "/m/c/dm-oovi", "/m/bots", "/m/settings", "/m/connectors", "/m/connectors/gmail", "/m/connectors/add", "/m/login", "/app", "/app/c/dm-oovi", "/app/settings"];
const chrome = process.env.CHROME_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : require("playwright").chromium.executablePath());

(async () => {
  const next = spawn(process.execPath, [path.join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(NEXT_PORT), "-H", "127.0.0.1"], { cwd: WEB, stdio: "ignore" });
  process.on("exit", () => next.kill());
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${NEXT_PORT}/m/manifest.webmanifest`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const sb = await startStandin({ port: PORT, nextPort: NEXT_PORT });
  sb.state.signedIn = true;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "oovi-lh-"));
  let bad = 0;
  for (const p of PAGES) {
    const file = path.join(out, `${p.replace(/\W+/g, "_") || "root"}.json`);
    const cmd = process.env.LIGHTHOUSE ? [process.env.LIGHTHOUSE] : ["npx", "-y", "lighthouse@11.7.1"];
    // spawnSync would block the stand-in in this same process: run Lighthouse as a child and wait for it.
    await new Promise((resolve) => {
      const lh = spawn(cmd[0], [
        ...cmd.slice(1),
        `http://127.0.0.1:${PORT}${p}`,
        "--quiet",
        "--output=json",
        `--output-path=${file}`,
        "--only-categories=pwa,accessibility,best-practices",
        "--form-factor=mobile",
        `--extra-headers=${JSON.stringify({ Cookie: "standin=1" })}`,
        "--chrome-flags=--headless=new --no-sandbox",
      ], { env: { ...process.env, CHROME_PATH: chrome }, stdio: "inherit" });
      lh.on("exit", resolve);
    });
    if (!fs.existsSync(file)) {
      console.log(`FAIL ${p}: Lighthouse did not run`);
      bad++;
      continue;
    }
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    const scores = Object.fromEntries(Object.entries(r.categories).map(([k, c]) => [k, c.score]));
    // The web version (/app) is not installable on purpose (installing is the phone's /m): no PWA bar there.
    const low = Object.entries(BAR).filter(([k, min]) => scores[k] !== undefined && scores[k] < min && !(k === "pwa" && p.startsWith("/app")));
    const failed = Object.values(r.audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary").map((a) => a.id);
    console.log(`${low.length ? "FAIL" : "PASS"} ${p} ${Object.entries(scores).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(", ")}${failed.length ? ` | not passed: ${failed.join(", ")}` : ""}`);
    if (low.length) bad++;
  }
  await sb.close();
  next.kill();
  console.log(`\nlighthouse: ${PAGES.length - bad} of ${PAGES.length} pages at or above the bar (${JSON.stringify(BAR)})`);
  process.exit(bad ? 1 : 0);
})();
