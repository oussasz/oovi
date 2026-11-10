// The built oovi server on a throwaway data folder (OOVI_TEST_DATA), with a synthetic local
// session (fake user, fake token) so no account sign-in is needed. Started by phase1-scenario.cjs.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const data = process.env.OOVI_TEST_DATA;
fs.mkdirSync(data, { recursive: true });
process.env.OOVI_DATA = data;
process.env.OOVI_DOWNLOADS = path.join(data, "downloads");
process.env.HOSTNAME = "127.0.0.1";

const sessionFile = path.join(data, "session.json");
if (!fs.existsSync(sessionFile)) {
  const keyFile = path.join(data, ".device-key");
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"));
  const key = Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update("fake-local-test-token", "utf8"), c.final()]);
  const token = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
  const user = { id: "p1test", email: "tester@example.test", name: "Phase Tester", image: null };
  fs.writeFileSync(sessionFile, JSON.stringify({ token, user, onboarded: true, savedAt: Date.now() }, null, 1));
}

const dir = process.env.OOVI_STANDALONE || path.resolve(__dirname, "../../.next/standalone");
process.chdir(dir);
require(path.join(dir, "server.js"));
