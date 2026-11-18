// oovi cloud, the pure parts (web/lib/cloud-core.ts): what clients may send, the account limit, the runner's
// secret check, and the admin's one-line view (counts and sizes only).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_LIMIT_BYTES,
  checkChatPut,
  checkClaim,
  checkDone,
  checkJobCreate,
  checkVaultPut,
  fmtBytes,
  isId,
  isUserId,
  isUuid,
  logCode,
  parseDeviceHeader,
  parseSince,
  quotaAfter,
  runnerAuth,
  sameOrigin,
  syncCell,
} from "../../web/lib/cloud-core.ts";

test("ids: the app's chat and connector ids pass; paths, spaces and empty ones don't", () => {
  for (const ok of ["c_1731940000000", "mcp:gmail", "chat-1.2", "a".repeat(100)]) assert.equal(isId(ok), true, ok);
  for (const bad of ["", ".", "..", "a/b", "a b", "../x", "a".repeat(101), 5, null, "é"]) assert.equal(isId(bad), false, String(bad));
  assert.equal(isUserId("Qw3_rT-9"), true);
  assert.equal(isUserId("a:b"), false);
  assert.equal(isUuid("0b6c3c0e-6b8f-4f7e-9a62-0d6f3c4b2a11"), true);
  assert.equal(isUuid("0b6c3c0e6b8f4f7e9a620d6f3c4b2a11"), false);
});

test("chat PUT: a whole version and an object; the chat's own id must match the address", () => {
  assert.deepEqual(checkChatPut("c1", { baseVersion: 0, chat: { id: "c1", entries: [] } }), { baseVersion: 0, chat: { id: "c1", entries: [] } });
  assert.deepEqual(checkChatPut("c1", { baseVersion: 3, chat: { entries: [] } }), { baseVersion: 3, chat: { entries: [] } });
  assert.equal(typeof checkChatPut("c1", { baseVersion: 0, chat: { id: "c2" } }), "string");
  assert.equal(typeof checkChatPut("c1", { baseVersion: -1, chat: {} }), "string");
  assert.equal(typeof checkChatPut("c1", { baseVersion: 1.5, chat: {} }), "string");
  assert.equal(typeof checkChatPut("c1", { baseVersion: "1", chat: {} }), "string");
  assert.equal(typeof checkChatPut("c1", { baseVersion: 1, chat: [] }), "string");
  assert.equal(typeof checkChatPut("c1", null), "string");
  assert.equal(typeof checkVaultPut({ baseVersion: 0, data: "token" }), "string");
  assert.deepEqual(checkVaultPut({ baseVersion: 2, data: { token: "x" } }), { baseVersion: 2, data: { token: "x" } });
});

test("jobs: message, decision or stop for a chat; claim and done bodies", () => {
  assert.deepEqual(checkJobCreate({ chatId: "c1", kind: "message", payload: { text: "hi" } }), { chatId: "c1", kind: "message", payload: { text: "hi" } });
  assert.deepEqual(checkJobCreate({ chatId: "c1", kind: "stop" }), { chatId: "c1", kind: "stop", payload: {} });
  assert.equal(typeof checkJobCreate({ chatId: "c1", kind: "run_shell" }), "string");
  assert.equal(typeof checkJobCreate({ chatId: "../c", kind: "message" }), "string");
  assert.equal(typeof checkJobCreate({ chatId: "c1", kind: "message", payload: "text" }), "string");

  assert.deepEqual(checkClaim({ deviceId: "d1", kind: "desktop" }), { deviceId: "d1", chatIds: null });
  assert.deepEqual(checkClaim({ deviceId: "d1", chatIds: ["a", "a", "b"] }), { deviceId: "d1", chatIds: ["a", "b"] });
  assert.equal(typeof checkClaim({ deviceId: "d1", kind: "runner" }), "string", "a runner never claims through a user session");
  assert.equal(typeof checkClaim({ deviceId: "d1", chatIds: ["a/b"] }), "string");
  assert.equal(typeof checkClaim({}), "string");

  assert.deepEqual(checkDone({ deviceId: "d1", status: "done" }, "deviceId"), { by: "d1", status: "done", error: null });
  const long = checkDone({ runnerId: "r1", status: "failed", error: "x".repeat(2000) }, "runnerId");
  assert.ok(typeof long !== "string" && long.error!.length === 500, "error text is capped");
  assert.equal(typeof checkDone({ deviceId: "d1", status: "claimed" }, "deviceId"), "string");
  assert.equal(typeof checkDone({ runnerId: "r1", status: "done" }, "deviceId"), "string");
});

test("device header: desktop or phone with an id; runners can't pose as a device", () => {
  assert.deepEqual(parseDeviceHeader("phone:abc-1"), { kind: "phone", deviceId: "abc-1" });
  assert.deepEqual(parseDeviceHeader(" desktop:pc1 "), { kind: "desktop", deviceId: "pc1" });
  assert.equal(parseDeviceHeader("runner:r1"), null);
  assert.equal(parseDeviceHeader("phone:"), null);
  assert.equal(parseDeviceHeader("phone:a b"), null);
  assert.equal(parseDeviceHeader(null), null);
});

test("account limit: 100 MB; growing past it is refused, shrinking is always allowed", () => {
  assert.equal(ACCOUNT_LIMIT_BYTES, 100 * 1024 * 1024);
  assert.equal(quotaAfter(0, 0, 1000), 1000);
  assert.equal(quotaAfter(5000, 1000, 3000), 7000);
  assert.equal(quotaAfter(ACCOUNT_LIMIT_BYTES - 10, 0, 11), "over");
  assert.equal(quotaAfter(ACCOUNT_LIMIT_BYTES - 10, 0, 10), ACCOUNT_LIMIT_BYTES);
  // Already over (the limit was lowered): a chat that gets smaller still saves.
  assert.equal(quotaAfter(ACCOUNT_LIMIT_BYTES + 500, 800, 300), ACCOUNT_LIMIT_BYTES);
  assert.equal(quotaAfter(100, 5000, 10), 10, "never below zero");
});

test("since: absent, a date, or refused", () => {
  assert.equal(parseSince(null), null);
  assert.equal(parseSince(""), null);
  assert.equal(parseSince("yesterday"), "bad");
  const d = parseSince("2026-11-18T10:00:00.000Z");
  assert.ok(d instanceof Date && d.toISOString() === "2026-11-18T10:00:00.000Z");
});

test("runner secret: off when missing or short, constant-time equal otherwise", () => {
  const secret = "s".repeat(40);
  assert.equal(runnerAuth(secret, undefined), "off");
  assert.equal(runnerAuth("short", "short"), "off", "a short secret turns the runner API off");
  assert.equal(runnerAuth(null, secret), "denied");
  assert.equal(runnerAuth("", secret), "denied");
  assert.equal(runnerAuth(secret + "x", secret), "denied");
  assert.equal(runnerAuth(secret.slice(1), secret), "denied");
  assert.equal(runnerAuth(secret, secret), "ok");
});

test("logs keep a code, never the error's text", () => {
  assert.equal(logCode({ code: "23505", message: "Key (chat_id)=(secret text) already exists" }), "23505");
  assert.equal(logCode(new SyntaxError("Unexpected token in {\"text\":\"my message\"}")), "SyntaxError");
  assert.equal(logCode("my chat text"), "error");
  assert.equal(logCode({ code: "a long code with spaces and data" }), "error");
});

test("admin view: yes/no, chats and size only", () => {
  assert.equal(syncCell(null), "No");
  assert.equal(syncCell({ enabled: false, chats: 4, bytes: 10 }), "No");
  assert.equal(syncCell({ enabled: true, chats: 1, bytes: 2048 }), "Yes · 1 chat · 2 KB");
  assert.equal(syncCell({ enabled: true, chats: 12, bytes: 3.4 * 1024 * 1024 }), "Yes · 12 chats · 3.4 MB");
  assert.equal(fmtBytes(0), "0 B");
  assert.equal(fmtBytes(500), "500 B");
  assert.equal(fmtBytes(100 * 1024 * 1024), "100 MB");
  assert.equal(fmtBytes(3 * 1024 ** 3), "3.0 GB");
});

test("writes with the site's cookie only from the site itself", () => {
  const own = ["oovi.app", "localhost:3200"];
  assert.equal(sameOrigin("PUT", "https://oovi.app", own), true);
  assert.equal(sameOrigin("POST", "https://evil.example", own), false);
  assert.equal(sameOrigin("DELETE", "null", own), false);
  assert.equal(sameOrigin("GET", "https://evil.example", own), true, "reads can't be seen by another site anyway");
  assert.equal(sameOrigin("POST", null, own), true, "the desktop app and the runner send no Origin");
});

test("connector keys pass, AI model keys never sync", async () => {
  const { looksLikeAiKey, checkVaultPut } = await import("../../web/lib/cloud-core.ts");
  assert.equal(looksLikeAiKey({ apiKey: "sk-ant-api03-" + "a".repeat(40) }), true);
  assert.equal(looksLikeAiKey({ nested: [{ k: "sk-proj-" + "b".repeat(40) }] }), true);
  assert.equal(looksLikeAiKey({ k: "sk-" + "C".repeat(48) }), true, "an old OpenAI key");
  assert.equal(looksLikeAiKey({ k: "sk-or-v1-" + "d".repeat(64) }), true);
  assert.equal(looksLikeAiKey({ k: "gsk_" + "e".repeat(50) }), true);
  assert.equal(looksLikeAiKey({ notion: "ntn_" + "f".repeat(40), stripe: "sk_live_" + "g".repeat(30), oauth: { tokens: { access_token: "eyJhbGciOi.x.y" } } }), false);
  assert.equal(looksLikeAiKey({ note: "my key is short sk-ant-x" }), false);
  assert.equal(typeof checkVaultPut({ baseVersion: 0, data: { key: "sk-ant-api03-" + "a".repeat(40) } }), "string");
  assert.equal(typeof checkVaultPut({ baseVersion: 0, data: { key: "ntn_" + "f".repeat(40) } }), "object");
});

test("sign-ins only call public https addresses", async () => {
  const { checkConnectorUrl, isPrivateAddress } = await import("../../web/lib/cloud-core.ts");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:1.1.1.1"]) assert.equal(isPrivateAddress(ip), false, ip);
  assert.ok(checkConnectorUrl("https://mcp.notion.com/mcp") instanceof URL);
  for (const bad of ["http://mcp.notion.com/mcp", "https://localhost/mcp", "https://10.0.0.1/mcp", "https://[::1]/mcp", "https://user:pw@mcp.example.com", "https://printer.local/x", "ftp://x.com", "nope", 5]) {
    assert.equal(typeof checkConnectorUrl(bad), "string", String(bad));
  }
  assert.ok(checkConnectorUrl("http://127.0.0.1:4000/mcp", ["127.0.0.1:4000"]) instanceof URL, "only the test hosts named in the test setting");
  assert.equal(typeof checkConnectorUrl("http://127.0.0.1:4001/mcp", ["127.0.0.1:4000"]), "string");
});

test("after a sign-in, the phone's Connectors page", async () => {
  const { connectorsReturn } = await import("../../web/lib/cloud-core.ts");
  assert.equal(connectorsReturn("mcp:notion", { ok: true }), "/m/connectors?connected=mcp%3Anotion");
  assert.equal(connectorsReturn("mcp:notion", { error: "expired" }), "/m/connectors?error=expired&id=mcp%3Anotion");
  assert.equal(connectorsReturn(null, { error: "signed_out" }), "/m/connectors?error=signed_out");
});
