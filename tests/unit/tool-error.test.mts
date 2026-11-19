// lib/tool-error-core.ts against real error formats (tests/unit/fixtures/tool-errors.json: Zapier, Google, Slack,
// Notion, HubSpot, GitHub, Microsoft Graph, the MCP SDK, Node on Windows/macOS/Linux, French and Arabic).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyToolError, nextStepFor, readableError } from "../../lib/tool-error-core.ts";

type Case = { id: string; want: string; text: string; src: string };
const cases = JSON.parse(fs.readFileSync(new URL("./fixtures/tool-errors.json", import.meta.url), "utf8")) as Case[];
const ACCEPT: Record<string, string[]> = {
  "transient-or-input": ["transient", "input"],
  "input-or-admin": ["input"],
  noreason: ["unknown"],
  "notfound-or-share": ["notfound"],
  "network-local": ["refused"],
  "network-dns": ["dns"],
  "cert-proxy": ["cert"],
  "user-declined": ["declined"],
};

test("every real error format gets the right kind", () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const write = /^zap-write|^rpc-(timeout|closed)/.test(c.id);
    const got = classifyToolError(c.text, { write });
    const ok = ACCEPT[c.want] ?? [c.want];
    if (!ok.includes(got)) wrong.push(`${c.id}: want ${c.want}, got ${got}`);
  }
  assert.deepEqual(wrong, []);
});

test("a write that timed out or got a server error may have run; a read just failed", () => {
  assert.equal(classifyToolError("Error during execution: The app did not respond in time (timeout).", { write: true }), "maybe-ran");
  assert.equal(classifyToolError("Error during execution: The app did not respond in time (timeout).", { write: false }), "transient");
  assert.equal(classifyToolError("fetch failed", { causeCode: "ECONNRESET", write: true }), "maybe-ran");
  assert.equal(classifyToolError("fetch failed", { causeCode: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", write: true }), "cert");
});

test("the next step never tells the bot to retry an action that may have run, or to blame the connection for a missing item", () => {
  assert.match(nextStepFor("maybe-ran")!, /Don't run it again/);
  assert.match(nextStepFor("notfound")!, /connection is fine/);
  assert.match(nextStepFor("auth", "Gmail")!, /reconnect Gmail/);
  assert.equal(nextStepFor("unknown"), null);
});

test("JSON errors are made readable for reports", () => {
  assert.equal(readableError('{"error":{"code":403,"message":"Request had insufficient authentication scopes."}}'), "403: Request had insufficient authentication scopes.");
  assert.equal(readableError('{"ok":false,"error":"not_in_channel"}'), "not_in_channel");
  assert.equal(readableError("plain text"), "plain text");
});
