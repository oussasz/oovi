// One job's server: the app's own built server (.next/standalone) on a fresh data folder, in cloud-runner mode
// (OOVI_CLOUD_RUNNER=1, lib/cloud-runner.ts). Started by runner/index.mjs with an IPC channel; its environment
// holds no RUNNER_SECRET, only a token for this job's account that the runner's local proxy accepts.
// Its HTTP port is locked with a random launch secret nobody is given: the job is driven over IPC only.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const data = process.env.OOVI_DATA;
const token = process.env.OOVI_JOB_TOKEN;
const userId = process.env.OOVI_JOB_USER;
if (!data || !token || !userId || !process.send) {
  console.error("job-server: started without its job");
  process.exit(2);
}
delete process.env.OOVI_JOB_TOKEN;
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
process.env.OOVI_DOWNLOADS = path.join(data, "downloads");
process.env.HOSTNAME = "127.0.0.1";

// The session, sealed with this folder's own device key, the way lib/account.ts reads it.
const key = crypto.randomBytes(32);
fs.writeFileSync(path.join(data, ".device-key"), key.toString("hex"), { mode: 0o600 });
const iv = crypto.randomBytes(12);
const c = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([c.update(token, "utf8"), c.final()]);
const sealed = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
const user = { id: userId, email: "", name: process.env.OOVI_JOB_USER_NAME || "", image: null };
delete process.env.OOVI_JOB_USER_NAME;
fs.writeFileSync(path.join(data, "session.json"), JSON.stringify({ token: sealed, user, onboarded: true, savedAt: Date.now() }), { mode: 0o600 });

// lib/guard.ts: every API route needs this launch secret; nobody has it, so nothing can call the job's server.
globalThis.__ooviDesktop = { ...(globalThis.__ooviDesktop || {}), localToken: crypto.randomBytes(32).toString("hex") };

// The runner went away: so does this job.
process.on("disconnect", () => process.exit(0));

const dir = process.env.OOVI_STANDALONE;
process.chdir(dir);
require(path.join(dir, "server.js"));
