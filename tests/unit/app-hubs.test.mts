// Services that reach many apps (Zapier, Pipedream, Make): after connecting the service, a non-technical user must
// still add each app inside it. The Marketplace now shows where and how, under the service (lib/app-hubs-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { HUBS, hubOf, zapierAppFor } from "../../lib/app-hubs-core.ts";

test("Zapier, Pipedream and Make each say where their apps are added", () => {
  assert.deepEqual(Object.keys(HUBS).sort(), ["make", "pipedream", "zapier"]);
  for (const h of Object.values(HUBS)) assert.match(h.appsUrl, /^https:\/\//);
  // Zapier's apps are added from inside oovi, one button per app.
  assert.equal(HUBS.zapier.inApp, true);
  assert.equal(HUBS.pipedream.inApp, false);
  assert.equal(hubOf("zapier")?.name, "Zapier");
  assert.equal(hubOf("slack"), null);
});

test("an app the Marketplace sends to Zapier gets Zapier's own name for it", () => {
  assert.equal(zapierAppFor("gmail", "Gmail"), "Gmail");
  assert.equal(zapierAppFor("gdrive", "Google Drive, Docs & Sheets"), "Google Drive");
  assert.equal(zapierAppFor("m365", "Microsoft 365"), "Microsoft Outlook");
  assert.equal(zapierAppFor("gcalendar", "Google Calendar"), "Google Calendar");
  // Unknown: its own name, without what follows a comma.
  assert.equal(zapierAppFor("notion", "Notion"), "Notion");
  assert.equal(zapierAppFor("x", "Foo, Bar"), "Foo");
});
