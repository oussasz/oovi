import { test } from "node:test";
import assert from "node:assert/strict";
import { itemLines, rowOf as rowWith, rowsForTable, siteWide, withDetails, type RawItem } from "../../lib/page-list-core.ts";
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

test("the item's own page on the site is kept apart from the business's site; asked-for columns come along", () => {
  const r = rowOf({ text: ["Salon Lina"], links: ["https://dir.example/alger/salons", "https://dir.example/fiche/12", "https://lina.example/"], html: "", fields: { Prix: "2 500 DA" } }, "https://dir.example/alger/salons")!;
  assert.equal(r.page, "https://dir.example/fiche/12");
  assert.equal(r.link, "https://lina.example/");
  assert.deepEqual(rowsForTable(["Nom", "Prix"], [r], ""), [{ Nom: "Salon Lina", Link: "https://lina.example/", Prix: "2 500 DA" }]);
});

test("a number on most item pages of a site is the site's own, and is never given to an item", () => {
  const footer = "Phone: 021 00 00 00";
  const pages = [1, 2, 3, 4, 5].map((n) => [`Phone: 0550 11 22 0${n}`, footer, "Email: contact@dir.example"]);
  const skip = siteWide(pages);
  assert.deepEqual([...skip].sort(), ["e:contact@dir.example", "p:021000000"]);
  const row = withDetails({ name: "A", details: "", phone: "", email: "", link: "" }, [...pages[0]!, "Address: 12 Rue des Pins, Alger"], skip);
  assert.equal(row.phone, "0550 11 22 01");
  assert.equal(row.email, "");
  assert.equal(row.address, "12 Rue des Pins, Alger");
  // Too few pages to judge: nothing is thrown away.
  assert.equal(siteWide(pages.slice(0, 3)).size, 0);
});

test("an item's page only fills what the list didn't give", () => {
  const row = withDetails({ name: "A", details: "", phone: "0550 00 00 01", email: "", link: "" }, ["Phone: 0660 99 99 99", "Email: a@a.example"], new Set());
  assert.equal(row.phone, "0550 00 00 01");
  assert.equal(row.email, "a@a.example");
});
