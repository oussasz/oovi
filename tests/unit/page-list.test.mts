import { test } from "node:test";
import assert from "node:assert/strict";
import { itemLines, rowOf as rowWith, rowsForTable, type RawItem } from "../../lib/page-list-core.ts";
import { contactDetails, phonesInText } from "../../lib/contacts.ts";

// As tools.ts calls it.
const rowOf = (item: RawItem, url: string) => rowWith(item, url, contactDetails(`<html><body>${item.html}</body></html>`), phonesInText(itemLines(item).join("\n")));

test("an item becomes a row: name, the rest, phone, email, the business's own site", () => {
  const r = rowOf(
    {
      text: ["Café Hydra", "Café · 12 Rue des Pins", "0550 12 34 56", "Café Hydra"],
      links: ["https://annuaire.example/cafe-hydra", "https://cafehydra.example/"],
      html: '<div><a href="mailto:hello@cafehydra.example">mail</a><a href="tel:+213550123456">call</a></div>',
    },
    "https://www.annuaire.example/alger/cafes",
  )!;
  assert.equal(r.name, "Café Hydra");
  assert.equal(r.details, "Café · 12 Rue des Pins · 0550 12 34 56");
  assert.equal(r.phone, "+213550123456"); // the same number written twice is listed once
  assert.equal(r.email, "hello@cafehydra.example");
  assert.equal(r.link, "https://cafehydra.example/");
});

test("a bare local number in an item is a phone; a date, a price and a rating are not", () => {
  assert.deepEqual(phonesInText("Salon Lina\n021 23 45 67\nOuvert 09:00-18:00 · 4,5 (120) · 2 500 DA · 12/05/2024"), ["021 23 45 67"]);
  assert.deepEqual(phonesInText("Ref 2024-05-12 10:30"), []);
});

test("an item without text is dropped", () => {
  assert.equal(rowOf({ text: ["  "], links: [], html: "" }, "https://x.example"), null);
});

test("rows go into the columns a table already has; missing fields get their own column only when used", () => {
  const rows = [{ name: "A", details: "d", phone: "0550 11 22 33", email: "", link: "https://a.example" }];
  assert.deepEqual(rowsForTable(["Nom", "Quartier", "Téléphone", "Site web", "Source"], rows, "https://dir.example"), [
    { Nom: "A", Details: "d", "Téléphone": "0550 11 22 33", "Site web": "https://a.example", Source: "https://dir.example" },
  ]);
  assert.deepEqual(rowsForTable(undefined, rows, "https://dir.example"), [{ Name: "A", Details: "d", Phone: "0550 11 22 33", Link: "https://a.example", Source: "https://dir.example" }]);
});
