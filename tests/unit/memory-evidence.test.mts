// Facts about the user come from their own words (lib/memory-evidence-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { unbackedFact } from "../../lib/memory-evidence-core.ts";

const said = "Je m'appelle Oussama, je gère une boutique de café à Oran. Mon numéro: 0555 12 34 56. On m'écrit sur oussama@shop.dz";

test("facts from the user's words are backed", () => {
  assert.equal(unbackedFact("Oussama runs a coffee shop in Oran", said), null, "a fact translated into English is fine");
  assert.equal(unbackedFact("Gère une boutique de café à Oran", said), null);
  assert.equal(unbackedFact("Phone: 0555123456", said), null);
  assert.equal(unbackedFact("Email: oussama@shop.dz", said), null);
  assert.equal(unbackedFact("يحب القهوة السوداء", "أنا نحب القهوة السوداء بزاف"), null);
});

test("guesses and page claims are not", () => {
  assert.match(unbackedFact("Phone: 0661 99 88 77", said) ?? "", /isn't in anything/);
  assert.match(unbackedFact("Email: contact@other.com", said) ?? "", /isn't in anything/);
});
