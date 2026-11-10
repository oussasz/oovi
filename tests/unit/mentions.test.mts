import { test } from "node:test";
import assert from "node:assert/strict";
import { handoffMentions } from "../../lib/mentions.ts";

const team = [{ id: "c", name: "c" }, { id: "m", name: "mouloud" }, { id: "l", name: "Lina" }, { id: "s", name: "Scout" }];
const h = (text: string, replied: string[] = []) => handoffMentions(text, team, new Set(replied));

test("asking a teammate to do something hands them the turn", () => {
  assert.deepEqual(h("@Lina please write the Facebook post."), ["l"]);
  assert.deepEqual(h("@Lina, write the post.\n@Scout and @c, check the prices."), ["l", "s", "c"]);
  assert.deepEqual(h("- @Scout find three sources"), ["s"]);
  assert.deepEqual(h("Can you send the link, @c?"), ["c"]);
  assert.deepEqual(h("هل يمكنك إرسال الرابط @c؟"), ["c"]);
});

test("referring to or agreeing with a teammate doesn't (the c / mouloud loop)", () => {
  assert.deepEqual(h("La deadline est le 12 nov, pas demain comme l'a écrit @mouloud."), []);
  assert.deepEqual(h("Marys, @mouloud a raison : le dashboard n'a rien renvoyé.", ["m"]), []);
  assert.deepEqual(h("Merci @mouloud, ta correction est juste."), []);
  assert.deepEqual(h("Le tunnel est coupé : demande à @c de relancer le Business OS.", ["c"]), []);
  assert.deepEqual(h("@c a raison.", ["c"]), []);
});

test("a teammate who already replied gets the turn back only for a question", () => {
  assert.deepEqual(h("@Lina, shorten it.", ["l"]), []);
  assert.deepEqual(h("@Lina, can you shorten it?", ["l"]), ["l"]);
});
