import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSnapshot, renderSnapshot, SNAPSHOT_FILE } from "../../scripts/sync-web-catalog.mts";
import { validateCatalogData } from "../../web/lib/catalog.ts";

// The Marketplace items live in the app (lib/catalog.ts). The admin console keeps a generated copy of them
// (web/lib/builtin-catalog.json) so it can show every item and copy any of them into the database, where the
// owner edits them. These tests keep that copy honest.

test("web/lib/builtin-catalog.json is current (fix: node scripts/sync-web-catalog.mts)", () => {
  // Line endings aside: a Windows checkout turns them into CRLF, which changes nothing in the data.
  assert.equal(fs.readFileSync(SNAPSHOT_FILE, "utf8").replace(/\r\n/g, "\n"), renderSnapshot(buildSnapshot()));
});

test("every built-in item passes the console's check, so it can always be copied into the database", () => {
  const bad = buildSnapshot()
    .map((it) => ({ id: `${it.kind} ${it.id}`, errors: validateCatalogData(it.kind, it.data) }))
    .filter((x) => x.errors.length);
  assert.deepEqual(bad, []);
});

test("ids are unique across connectors, skills and plugins (the database uses the id alone)", () => {
  const ids = buildSnapshot().map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("an expert keeps its profile links and its one-line voice, and a connector keeps its setup page", () => {
  const items = buildSnapshot();
  const coach = items.find((i) => i.id === "abdelaziz-benkirat")!.data as { links?: { url: string }[]; bots: { about?: string }[] };
  assert.ok(coach.links?.[0]?.url.startsWith("https://"), "the expert's link");
  assert.ok(coach.bots[0]?.about, "the bot's one-line voice");
  assert.ok((items.find((i) => i.id === "zapier")!.data as { setupUrl?: string }).setupUrl, "zapier's setup page");
});

test("the console refuses a field it does not know (typos), but knows every field the app uses", () => {
  assert.ok(validateCatalogData("skill", { name: "x", description: "y", category: "work", body: "z", surprise: 1 }).some((e) => e.includes("surprise")));
  assert.deepEqual(validateCatalogData("skill", { name: "x", description: "y", category: "work", body: "z" }), []);
});
