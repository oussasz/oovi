// Docker's health check: the runner writes health.json every 15 s and after each claim. Healthy when it was
// written in the last 90 s and the website answered a claim in the last 10 minutes.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const dir = process.env.RUNNER_STATE_DIR || process.env.RUNNER_TMP || path.join(os.tmpdir(), "oovi-runner");
try {
  const h = JSON.parse(fs.readFileSync(path.join(dir, "health.json"), "utf8"));
  const now = Date.now();
  if (now - h.at > 90_000) throw new Error("runner loop stuck");
  if (now - h.lastClaimOk > 10 * 60_000) throw new Error("website unreachable for 10 minutes");
  console.log(`ok: ${h.active} job(s) running`);
  process.exit(0);
} catch (e) {
  console.log(`unhealthy: ${e.message}`);
  process.exit(1);
}
