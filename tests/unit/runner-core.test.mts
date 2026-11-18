// The cloud runner's pure parts (runner/core.mjs).
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JavaScript module without types
import * as core from "../../runner/core.mjs";

const SECRET = "s".repeat(40);

test("settings: the website must be https (localhost may be http) and the secret long", () => {
  assert.match(core.readConfig({}), /OOVI_WEB_URL/);
  assert.match(core.readConfig({ OOVI_WEB_URL: "http://example.com", RUNNER_SECRET: SECRET }), /https/);
  assert.match(core.readConfig({ OOVI_WEB_URL: "https://example.com", RUNNER_SECRET: "short" }), /RUNNER_SECRET/);
  const c = core.readConfig({ OOVI_WEB_URL: "https://example.com/", RUNNER_SECRET: SECRET, RUNNER_CONCURRENCY: "99", RUNNER_ID: "vm-1" });
  assert.equal(c.web, "https://example.com");
  assert.equal(c.concurrency, 16);
  assert.equal(c.perAccount, 1);
  assert.equal(c.runnerId, "vm-1");
  assert.equal(core.readConfig({ OOVI_WEB_URL: "http://127.0.0.1:3000", RUNNER_SECRET: SECRET }).concurrency, 2);
});

test("a job's server reaches theOovi, its setup and the catalog only", () => {
  assert.equal(core.proxyRoute("POST", "/api/v1/ai/messages"), "ai");
  assert.equal(core.proxyRoute("GET", "/api/v1/ai/status"), "status");
  assert.equal(core.proxyRoute("GET", "/api/v1/setup"), "setup-get");
  assert.equal(core.proxyRoute("PUT", "/api/v1/setup/"), "setup-put");
  assert.equal(core.proxyRoute("GET", "/api/v1/catalog"), "catalog");
  for (const [m, p] of [["POST", "/api/v1/ai/image"], ["GET", "/api/v1/me"], ["POST", "/api/v1/feedback"], ["DELETE", "/api/v1/setup"], ["GET", "/api/v1/cloud/runner/claim"], ["POST", "/api/v1/places"], ["GET", "/api/v1/telegram/relay"]]) assert.equal(core.proxyRoute(m, p), null, `${m} ${p}`);
  assert.equal(core.runnerStatus(3).desktop, false);
  assert.equal(core.runnerStatus(3).state, "ok");
});

test("a retried job starts its message over, other entries stay", () => {
  const chat = { id: "c", entries: [{ id: "u1", kind: "user" }, { id: "b1", kind: "bot" }, { id: "j1", kind: "user" }, { id: "b2", kind: "bot" }, { id: "b3", kind: "bot" }, { id: "u3", kind: "user" }], pending: { queue: [] } };
  const r = core.resetForRetry(chat, "j1");
  assert.deepEqual(r.entries.map((e: { id: string }) => e.id), ["u1", "b1", "u3"]);
  assert.equal(r.pending, undefined);
  assert.equal(core.resetForRetry(chat, "nope"), chat);
  assert.equal(core.entryIdFor({ id: "1b2c-33", payload: {} }), "j1b2c33");
  assert.equal(core.entryIdFor({ id: "x", payload: { entryId: "phone-1" } }), "phone-1");
  assert.equal(core.entryIdFor({ id: "x", payload: { entryId: "../x" } }), "jx");
});

test("a conflict keeps this runner's entries and adds the other device's in time order", () => {
  const mine = { id: "c", name: "mine", entries: [{ id: "a", at: 1, text: "mine" }, { id: "c", at: 3 }] };
  const theirs = { id: "c", name: "theirs", entries: [{ id: "a", at: 1, text: "theirs" }, { id: "b", at: 2 }, { id: "d", at: 9 }] };
  const m = core.mergeChat(mine, theirs);
  assert.deepEqual(m.entries.map((e: { id: string }) => e.id), ["a", "b", "c", "d"]);
  assert.equal(m.entries[0].text, "mine");
  assert.equal(m.name, "mine");
  assert.equal(core.mergeChat(mine, null), mine);
});

test("fairness: one account can't take every place; one chat runs once", () => {
  const active = [{ userId: "u1", chatId: "c1" }];
  assert.deepEqual(core.busyAccounts(active, 1), ["u1"]);
  assert.deepEqual(core.busyAccounts(active, 2), []);
  assert.equal(core.canStart({ userId: "u1", chatId: "c1" }, active, 4), "chat busy");
  assert.equal(core.canStart({ userId: "u1", chatId: "c2" }, active, 1), "account busy");
  assert.equal(core.canStart({ userId: "u2", chatId: "c1" }, active, 1), null);
});

test("waiting between claims grows when idle and stays bounded", () => {
  assert.equal(core.nextDelay(0, false), 2000);
  assert.ok(core.nextDelay(3, false) > core.nextDelay(1, false));
  assert.equal(core.nextDelay(50, true), 30_000);
});

test("outcomes, time zones and error codes", () => {
  assert.deepEqual(core.outcomeOf({ needsComputer: "open_app" }), { status: "needs_computer" });
  assert.deepEqual(core.outcomeOf({ error: "timeout" }), { status: "failed", error: "timeout" });
  assert.deepEqual(core.outcomeOf({}), { status: "done" });
  assert.equal(core.timeZoneOf("Africa/Algiers"), "Africa/Algiers");
  assert.equal(core.timeZoneOf("Mars/Olympus"), "UTC");
  assert.equal(core.timeZoneOf("$(rm -rf)"), "UTC");
  assert.equal(core.errorCode(new Error("prepare timed out")), "timeout");
  assert.equal(core.errorCode(new Error("Le client a écrit : mon mot de passe")), "error");
});

test("logs never carry chat text, names or tokens", () => {
  const line = JSON.parse(core.logLine({ ev: "job_end", job: "abc", text: "secret chat", name: "Sara", token: "t", status: "done", code: "a\nb" }));
  assert.equal(line.text, undefined);
  assert.equal(line.name, undefined);
  assert.equal(line.token, undefined);
  assert.equal(line.code, "a b");
  assert.equal(line.status, "done");
});
