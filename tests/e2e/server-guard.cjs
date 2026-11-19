// Required first by every scenario that starts tests/e2e/server.cjs. If that server exits on its own with an error
// (its port is taken by a server from an earlier run, a crash at start-up), the scenario stops at once with the
// server's last error lines, instead of waiting for the port and then testing the wrong (old) server.
// Servers the scenario stops itself (kill) are not errors.
const cp = require("node:child_process");

const spawn0 = cp.spawn;
cp.spawn = function guardedSpawn(cmd, args, ...rest) {
  const child = spawn0.call(this, cmd, args, ...rest);
  if (Array.isArray(args) && args.some((a) => /[\\/]server\.cjs$/.test(String(a)))) watch(child);
  return child;
};

function watch(child) {
  let tail = "";
  const keep = (d) => {
    tail = (tail + d).slice(-4000);
  };
  child.stderr?.on("data", keep);
  child.stdout?.on("data", keep);
  child.on("exit", (code, signal) => {
    if (signal || child.killed || code === 0 || code === null) return;
    const lines = tail.trim().split(/\r?\n/).slice(-15).join("\n");
    console.error(`\nFAIL: the test server (server.cjs) exited with code ${code} before the scenario finished.${lines ? `\n${lines}` : ""}`);
    process.exit(1);
  });
}
