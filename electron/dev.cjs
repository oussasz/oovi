// `npm run dev`: Next.js dev server (hot reload) + the desktop window on top of it.

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = 3100;
const URL = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, OOVI_DATA: process.env.OOVI_DATA || path.join(ROOT, "data") };

const nextDev = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, stdio: "inherit", env });

function stop(code) {
  nextDev.kill();
  process.exit(code ?? 0);
}

function whenReady(cb) {
  const attempt = () =>
    http
      .get(URL, (res) => {
        res.resume();
        cb();
      })
      .on("error", () => setTimeout(attempt, 500));
  attempt();
}

whenReady(() => {
  const electronBin = require("electron"); // path to the Electron binary
  const win = spawn(electronBin, [ROOT], { cwd: ROOT, stdio: "inherit", env: { ...env, OOVI_DEV_URL: URL } });
  win.on("exit", (code) => stop(code));
});

process.on("SIGINT", () => stop(0));
nextDev.on("exit", (code) => process.exit(code ?? 0));
