import { test } from "node:test";
import assert from "node:assert/strict";
import { atLeast, categoryWords, inCategory, isOpen, nameHas, overlaps, placeRow, sizeKm, topCategories, type Place } from "../../lib/places-core.ts";

const salon: Place = {
  names: { primary: "Salon  Lina" },
  basic_category: "personal_or_beauty_service",
  taxonomy: { primary: "beauty_salon", hierarchy: ["lifestyle_services", "personal_or_beauty_service", "beauty_salon"], alternates: null },
  phones: ["+213550112233"],
  emails: ["lina@example.test"],
  websites: null,
  socials: ["https://www.facebook.com/123"],
  addresses: [{ freeform: "12 rue des Roses ", locality: "Kouba", postcode: "16050" }],
};
const cafe: Place = { names: { primary: "Café Eddy" }, basic_category: "cafe", taxonomy: { primary: "cafe", hierarchy: ["food_and_drink", "cafe"] }, websites: ["https://eddy.example"], socials: ["https://facebook.com/eddy"] };

test("categories: plurals, accents and two-word names; a word must match a whole word", () => {
  assert.ok(inCategory(salon, categoryWords(["Beauty salons"])));
  assert.ok(inCategory(salon, categoryWords("beauty")));
  assert.ok(inCategory(cafe, categoryWords(["cafés", "coffee"])));
  assert.ok(!inCategory(cafe, categoryWords(["beauty"])));
  assert.ok(!inCategory({ basic_category: "internet_cafe_supplier" }, categoryWords(["fe"])));
  assert.ok(inCategory(cafe, [])); // no category asked: everything
});

test("a place becomes a table row: site first, the social page kept beside it", () => {
  assert.deepEqual(placeRow(salon, "Overture Maps"), { name: "Salon Lina", details: "beauty salon", phone: "+213550112233", email: "lina@example.test", link: "https://www.facebook.com/123", address: "12 rue des Roses, Kouba, 16050", source: "Overture Maps" });
  const r = placeRow(cafe, "Overture Maps")!;
  assert.equal(r.link, "https://eddy.example");
  assert.deepEqual(r.extra, { Social: "https://facebook.com/eddy" });
  assert.equal(placeRow({ names: { primary: " " } }, "x"), null);
  // A placeholder link in the data is not a website: the social page is used instead.
  assert.equal(placeRow({ names: { primary: "A" }, websites: ["http://....", "notaurl"], socials: ["https://facebook.com/a"] }, "x")!.link, "https://facebook.com/a");
});

test("closed places are left out; name filter ignores accents and case", () => {
  assert.ok(isOpen(cafe) && !isOpen({ operating_status: "permanently_closed" }));
  assert.ok(nameHas(cafe, "cafe EDDY") && nameHas(cafe, "edd") && !nameHas(cafe, "lina") && !nameHas(cafe, "ddy"));
  assert.ok(nameHas({ names: { primary: "Café Testville 9" } }, "testville 9") && !nameHas({ names: { primary: "Café Testville 39" } }, "testville 9"));
});

test("areas: overlap, size, and a point widened to about 3 km", () => {
  const hydra = { xmin: 3.0015, xmax: 3.0493, ymin: 36.7243, ymax: 36.7571 };
  assert.ok(overlaps(hydra, { xmin: 2.9, xmax: 3.01, ymin: 36.7, ymax: 36.73 }) && !overlaps(hydra, { xmin: 3.1, xmax: 3.2, ymin: 36.7, ymax: 36.8 }));
  const s = sizeKm(hydra);
  assert.ok(s.w > 4 && s.w < 4.5 && s.h > 3.5 && s.h < 3.7, JSON.stringify(s));
  const p = sizeKm(atLeast({ xmin: 3.04, xmax: 3.04, ymin: 36.75, ymax: 36.75 }));
  assert.ok(Math.abs(p.w - 3) < 0.05 && Math.abs(p.h - 3) < 0.05, JSON.stringify(p));
  assert.deepEqual(atLeast(hydra), hydra);
});

test("when nothing matches, the area's own categories are listed", () => {
  assert.deepEqual(topCategories([salon, cafe, cafe]), ["cafe (2)", "beauty_salon (1)"]);
});
