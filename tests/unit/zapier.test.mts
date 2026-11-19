// oovi's Zapier page (lib/zapier-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { appArgs, appsIn, completeZapierRun, firstLink, zapierMode } from "../../lib/zapier-core.ts";
import { zapierNextStep } from "../../lib/tool-error-core.ts";

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

test("a write that failed with no reason says to check before running it again (no double event or email)", () => {
  const n = zapierNextStep("execute_zapier_write_action", "");
  assert.match(n, /^Zapier gave no reason\. Next step: this action may have run anyway\. Don't run it again before checking/);
  assert.doesNotMatch(n, /then try again once/);
  assert.doesNotMatch(zapierNextStep("execute_zapier_read_action", "bad request"), /2026-/, "no fixed example date");
});

test("a write's instructions carry the user's time zone; a read's don't", () => {
  const w = completeZapierRun("execute_zapier_write_action", { app: "google_calendar", action: "create_event", instructions: "Add Workshop on 2026-11-20 at 15:30" }, "Africa/Algiers");
  assert.equal(w.instructions, "Add Workshop on 2026-11-20 at 15:30 Times are in Africa/Algiers.");
  const r = completeZapierRun("execute_zapier_read_action", { app: "gmail", action: "find_email", instructions: "my last email", output: "subject" }, "Africa/Algiers");
  assert.equal(r.instructions, "my last email");
});

test("a wrong-input error says to inspect the action's fields, not to reconnect the app", () => {
  const n = zapierNextStep("execute_zapier_read_action", 'Invalid input: expected record, received string at "params"');
  assert.match(n, /inputs were wrong, not the connection/);
  assert.match(n, /inspect_zapier_actions/);
  assert.doesNotMatch(n, /isn't connected/);
  assert.match(zapierNextStep("execute_zapier_read_action", "Google Calendar is not connected"), /isn't connected in Zapier yet/);
});

test("a Zapier run gets its required plain-words fields, and params as an object", () => {
  const out = completeZapierRun("execute_zapier_read_action", { app: "google_calendar", action: "find_events", params: '{"start_time":"2026-11-18"}' });
  assert.deepEqual(out.params, { start_time: "2026-11-18" });
  assert.match(String(out.instructions), /find_events.*google_calendar.*start_time: 2026-11-18/);
  assert.ok(String(out.output).length > 10);
  const kept = { app: "gmail", action: "find_email", instructions: "my last email", output: "subject" };
  assert.deepEqual(completeZapierRun("execute_zapier_read_action", kept), kept);
  const other = { app: "gmail" };
  assert.equal(completeZapierRun("enable_zapier_action", other), other);
});

test("Zapier's 'missing required properties' (a dynamic list) is an input problem, not a connection one", () => {
  const n = zapierNextStep("execute_zapier_read_action", '{"isError":true,"error":"Missing argument values for required properties: task_list (Task List), show_completed (Display Completed Tasks). task_list is a dynamic enum — call list_choices first"}');
  assert.match(n, /inputs were wrong/);
  assert.match(n, /Zapier's error/);
  assert.doesNotMatch(n, /isn't connected/);
});
