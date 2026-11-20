// Addresses a bot is about to write to (lib/recipients-core.ts): one that appears nowhere in the user's
// messages, their files or anything read is flagged on the card, whatever the approval settings. In the
// 2026-11-20 conversation a bot proposed three addresses that were not in the user's file.
import test from "node:test";
import assert from "node:assert/strict";
import { addressesIn, unseenAddresses } from "../../lib/recipients-core.ts";

test("every address in an action's input is found, wherever it sits", () => {
  assert.deepEqual(addressesIn({ selected_api: "Gmail", params: { to: "a@x.dz, B@Y.com", cc: ["c@z.net"], body: "Écrivez à d@w.org." } }).sort(), ["a@x.dz", "b@y.com", "c@z.net", "d@w.org"]);
  assert.deepEqual(addressesIn({ text: "no address here", n: 3 }), []);
});

test("an address that was read somewhere is fine; one that appears nowhere is named", () => {
  const seen = (a: string) => ["a@x.dz", "c@z.net"].includes(a);
  assert.deepEqual(unseenAddresses({ params: { to: "a@x.dz", cc: "invented@nowhere.com" } }, seen), ["invented@nowhere.com"]);
  assert.deepEqual(unseenAddresses({ params: { to: "A@X.dz" } }, seen), []);
});

test("without anything to check against (an image, a PDF the bot saw), nothing is flagged", () => {
  assert.deepEqual(unseenAddresses({ to: "x@y.dz" }, null), []);
});
