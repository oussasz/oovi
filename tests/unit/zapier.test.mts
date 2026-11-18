// oovi's Zapier page (lib/zapier-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { appArgs, appsIn, firstLink, zapierMode, zapierNextStep } from "../../lib/zapier-core.ts";

test("inputs for a tool that names an app, from its schema", () => {
  assert.deepEqual(appArgs({ properties: { app: { type: "string" } }, required: ["app"] }, "Gmail"), { app: "Gmail" });
  assert.deepEqual(appArgs({ properties: { selected_api: { type: "string" }, action: { type: "string", enum: ["set_default", "add_connection"] } }, required: ["selected_api", "action"] }, "Gmail"), { selected_api: "Gmail", action: "add_connection" });
  assert.equal(typeof appArgs({ properties: { app: {}, token: { type: "string" } }, required: ["token"] }, "Gmail"), "string");
  assert.deepEqual(appArgs(undefined, "Gmail"), {});
});

test("links, apps and mode", () => {
  assert.equal(firstLink('Open https://mcp.zapier.com/mcp/servers/abc/connections?app=gmail. Then come back.'), "https://mcp.zapier.com/mcp/servers/abc/connections?app=gmail");
  assert.equal(firstLink("no link"), null);
  assert.deepEqual(appsIn("Enabled: gmail_send_email, GoogleCalendarCLIAPI find_event, Slack: post", ["Gmail", "Google Calendar", "Slack", "Notion"]), ["Gmail", "Google Calendar", "Slack"]);
  assert.equal(zapierMode(["inspect_zapier_actions", "execute_zapier_read_action"]), "agentic");
  assert.equal(zapierMode(["get_configuration_url", "gmail_send_email"]), "classic");
  assert.equal(zapierMode(["x"]), "none");
});

test("a failed action tells the bot what to do, and not to paste links", () => {
  const n = zapierNextStep("execute_zapier_read_action", "");
  assert.match(n, /^Zapier gave no reason\. Next step:/);
  assert.match(n, /Your apps/);
});
