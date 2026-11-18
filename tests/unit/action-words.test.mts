// Approval cards in plain words (lib/action-words-core.ts): no tool names or raw data on the card itself.
import test from "node:test";
import assert from "node:assert/strict";
import { appName, describeConnector, technicalDetail } from "../../lib/action-words-core.ts";

test("the owner's example: Zapier turning on Google Tasks", () => {
  const w = describeConnector("enable_zapier_action", { selected_api: "GoogleTasksCLIAPI", app_display_name: "Google Tasks" }, "Zapier");
  assert.deepEqual(w, { verb: "turnOn", app: "Google Tasks", facts: [] });
  assert.equal(describeConnector("enable_zapier_action", { selected_api: "GoogleTasksCLIAPI" }, "Zapier").app, "Google Tasks");
});

test("common actions, any connector", () => {
  const send = describeConnector("send_email", { to: ["karim@x.dz"], subject: "Devis", body: "Bonjour Karim,\n voici le devis." }, "Gmail");
  assert.equal(send.verb, "send");
  assert.equal(send.object, "email");
  assert.equal(send.app, "Gmail");
  assert.deepEqual(send.facts.map((f) => f.label), ["to", "subject", "text"]);
  assert.equal(send.facts[2]!.value, "Bonjour Karim, voici le devis.");
  const ev = describeConnector("createEvent", { summary: "RDV client", start: "2026-11-20T10:00" }, "Google Calendar");
  assert.deepEqual([ev.verb, ev.object, ev.facts.map((f) => f.label).join()], ["create", "event", "title,when"]);
  assert.equal(describeConnector("slack_post_message", { channel: "#ventes", text: "hi" }, "Slack").object, "message");
  assert.equal(describeConnector("hubspot_update_contact", {}, "HubSpot").verb, "update");
  assert.equal(describeConnector("weird_tool", {}, "X").verb, "do");
});

test("Zapier's generic action: the app and action from its inputs", () => {
  const w = describeConnector("execute_zapier_write_action", { app: "gmail", action: "send_email", instructions: "Send the invoice to Karim" }, "Zapier");
  assert.deepEqual([w.verb, w.object, w.app], ["send", "email", "Gmail"]);
  assert.ok(w.facts.some((f) => f.label === "text" && /invoice/.test(f.value)));
});

test("names and details", () => {
  assert.equal(appName("google_calendar"), "Google Calendar");
  assert.equal(appName("GoogleTasksCLIAPI"), "Google Tasks");
  assert.match(technicalDetail("mcp_zapier_enable_zapier_action", { a: 1 }), /^mcp_zapier_enable_zapier_action\n\{\n  "a": 1\n\}$/);
});
