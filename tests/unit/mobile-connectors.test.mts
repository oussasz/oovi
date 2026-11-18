import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addableHere,
  catalogConnectors,
  connectorViews,
  finishProblem,
  looksLikeAiKey,
  needsAction,
  newConnectorId,
  pendingToHandle,
  signInReturn,
  signedOut,
  vaultFromCatalog,
  viewOfVault,
  withSettings,
  type VaultItem,
} from "../../web/app/m/_lib/connectors.ts";

const gmail: VaultItem = {
  name: "Gmail",
  transport: "http",
  url: "https://mcp.example.test/gmail?token=SECRET-URL",
  auth: "oauth",
  headers: { Authorization: "Bearer SECRET-HEADER" },
  env: { EMPTY: "" },
  oauth: { tokens: { access_token: "SECRET-TOKEN" }, signedInAt: 5 },
  enabled: true,
  trusted: false,
  bots: ["nova", "nova", "oovi"],
};

test("what the phone shows of a connector never holds its keys, tokens, address or command", () => {
  const v = viewOfVault("gmail", gmail);
  assert.deepEqual(v, { id: "gmail", name: "Gmail", enabled: true, bots: ["nova", "oovi"], kind: "remote", oauth: true, signedIn: true, keys: 1, missingKeys: 1, inCloud: true });
  assert.ok(!/SECRET/.test(JSON.stringify(v)));
  const local = viewOfVault("files", { name: "Files", transport: "stdio", command: "npx", args: ["secret-arg"], enabled: false });
  assert.equal(local.kind, "local");
  assert.equal(local.enabled, false);
  assert.ok(!JSON.stringify(local).includes("npx"));
  assert.equal(viewOfVault("x", null).name, "x");
});

test("the list: vault first by name, then connectors only the setup knows (read-only)", () => {
  const vault = { b: viewOfVault("b", { name: "Notion", transport: "http", enabled: true }), a: viewOfVault("a", gmail) };
  const setup = { bots: [], groups: [], mainId: null, connectors: [{ id: "a", name: "Gmail", enabled: true, kind: "remote" as const }, { id: "z", name: "Old", enabled: false, kind: "local" as const }] };
  const list = connectorViews(setup, vault);
  assert.deepEqual(list.map((c) => [c.id, c.inCloud]), [["a", true], ["b", true], ["z", false]]);
  assert.equal(needsAction(viewOfVault("q", { ...gmail, oauth: undefined })), true);
  assert.equal(needsAction(viewOfVault("q", { ...gmail, enabled: false, oauth: undefined })), false);
});

test("changing on/off or bots keeps the keys and the sign-in; signing out keeps the connector", () => {
  const off = withSettings(gmail, { enabled: false, bots: ["rex", "rex"] });
  assert.equal(off.enabled, false);
  assert.deepEqual(off.bots, ["rex"]);
  assert.deepEqual(off.headers, gmail.headers);
  assert.deepEqual(off.oauth, gmail.oauth);
  const out = signedOut(gmail);
  assert.equal(out.oauth, undefined);
  assert.equal(out.url, gmail.url);
  assert.deepEqual(out.headers, gmail.headers);
});

test("catalog: built-ins replaced by the published copy, hidden ones out, order kept", () => {
  const builtin = [
    { id: "zapier", kind: "connector", sort: 10, data: { name: "Zapier", transport: "http", url: "https://z", oauth: true } },
    { id: "files", kind: "connector", sort: 20, data: { name: "Files", transport: "stdio", command: "npx" } },
    { id: "gone", kind: "connector", sort: 5, data: { name: "Gone", transport: "http", url: "https://g" } },
    { id: "skill1", kind: "skill", sort: 1, data: { name: "S" } },
  ];
  const published = [{ id: "zapier", kind: "connector", sort: 30, data: { name: "Zapier (new)", transport: "http", url: "https://z2", oauth: true }, published: true }, { id: "soon", kind: "connector", sort: 1, data: { name: "Soon", transport: "http", url: "https://s", soon: "Next month" } }];
  const list = catalogConnectors(builtin, published, ["gone"], { files: "/logos/files.png" });
  assert.deepEqual(list.map((c) => c.id), ["soon", "files", "zapier"]);
  assert.equal(list[2]!.name, "Zapier (new)");
  assert.equal(list[1]!.logo, "/logos/files.png");
  assert.deepEqual(list.map(addableHere), ["soon", "computer", "yes"]);
});

test("a new connector from the catalog: header template, required fields, AI model keys refused", () => {
  const gh = { id: "github", name: "GitHub", by: "GitHub", description: "", category: "dev", transport: "http" as const, url: "https://api.githubcopilot.com/mcp/", sort: 1, fields: [{ key: "token", label: "GitHub token", secret: true, to: "header" as const, name: "Authorization", template: "Bearer {value}" }, { key: "org", label: "Org", optional: true, to: "env" as const, name: "GH_ORG" }] };
  assert.equal(vaultFromCatalog(gh, {}, [], 1), "field:token");
  assert.equal(vaultFromCatalog(gh, { token: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" }, [], 1), "aikey:token");
  const v = vaultFromCatalog(gh, { token: " github_pat_123 " }, ["nova", "nova"], 7);
  assert.ok(typeof v === "object");
  assert.deepEqual(v, { name: "GitHub", transport: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer github_pat_123" }, enabled: true, trusted: false, createdAt: 7, bots: ["nova"], catalogId: "github" });
  const z = vaultFromCatalog({ ...gh, id: "zapier", name: "Zapier", fields: undefined, oauth: true }, {}, [], 1);
  assert.ok(typeof z === "object" && z.auth === "oauth");
  assert.equal(vaultFromCatalog({ ...gh, transport: "stdio", url: undefined }, {}, [], 1), "computer");
  assert.equal(looksLikeAiKey("AIzaSyA1234567890abcdefghijklmnopqrstu"), true);
  assert.equal(looksLikeAiKey("ghp_abcdef"), false);
});

test("ids like the desktop makes them, unique", () => {
  assert.equal(newConnectorId("Google Calendar", []), "google-calendar");
  assert.equal(newConnectorId("Google Calendar", ["google-calendar", "google-calendar-2"]), "google-calendar-3");
  assert.equal(newConnectorId("!!!", []), "connector");
});

test("coming back from a sign-in, and sign-ins finished in another browser", () => {
  assert.deepEqual(signInReturn("?connected=notion"), { kind: "connected", id: "notion" });
  assert.deepEqual(signInReturn("?error=denied&id=notion"), { kind: "error", code: "denied", id: "notion" });
  assert.deepEqual(signInReturn("?error=weird"), { kind: "error", code: "failed" });
  assert.deepEqual(signInReturn("?connected=<script>"), null);
  assert.equal(signInReturn(""), null);
  const p = pendingToHandle([
    { flowId: "f1", connectorId: "a", status: "waiting_finish", here: true },
    { flowId: "f2", connectorId: "b", status: "waiting_confirm", here: true },
    { flowId: "f3", connectorId: "c", status: "waiting_finish", here: false },
  ]);
  assert.deepEqual(p.finish.map((x) => x.flowId), ["f1"]);
  assert.deepEqual(p.confirm.map((x) => x.flowId), ["f2"]);
  assert.deepEqual([404, 409, 410, 502, 500].map(finishProblem), ["conn.err.notHere", "conn.err.confirm", "conn.err.expired", "conn.err.refused", "conn.err.failed"]);
});
