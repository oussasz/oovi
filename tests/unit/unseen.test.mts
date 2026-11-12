import { test } from "node:test";
import assert from "node:assert/strict";
import { dropUnseen, droppedNote, seenIn } from "../../lib/workfiles-core.ts";

const read = seenIn([
  "Blanche Pâtisserie — Sidi Yahia. Tél : +213 540 72 92 70 · contact@blanche.example",
  "Salon Dina\n0784.28.88.74",
  "Cabinet: (021) 23-45-67",
]);

test("a number is found however it was written, and an email whatever its case", () => {
  assert.ok(read("phone", "0540 72 92 70"));
  assert.ok(read("phone", "+213784288874"));
  assert.ok(read("phone", "+213 21 23 45 67")); // read as "(021) 23-45-67"
  assert.ok(read("email", "Contact@Blanche.example"));
  assert.ok(!read("phone", "0561 06 30 53"));
  assert.ok(!read("phone", "0540 72 92 71")); // one digit off is another number
  assert.ok(!read("email", "info@blanche.example"));
  // Two numbers that stand next to each other don't make a third one.
  const two = seenIn(["Prix 5 550 DA 0000 12"]);
  assert.ok(!two("phone", "0555 00 00 12"));
});

test("a phone number nobody read is left out of its cell; the row and its read values stay", () => {
  const cols = ["Nom", "Quartier", "Téléphone", "Email"];
  const { rows, dropped } = dropUnseen(
    cols,
    [
      ["Blanche Pâtisserie", "Hydra", "+213 540 72 92 70", "contact@blanche.example"],
      ["Or noir", "Dely Brahim", "0561 06 30 53", ""],
      { Nom: "Salon Dina", "Téléphone": "0784 28 88 74 / 0555 00 00 00", Email: "dina@invented.example" },
      ["Golden Barber", "Kouba", "à confirmer", ""],
    ],
    read,
  );
  assert.deepEqual(rows, [
    ["Blanche Pâtisserie", "Hydra", "+213 540 72 92 70", "contact@blanche.example"],
    ["Or noir", "Dely Brahim", "", ""],
    { Nom: "Salon Dina", "Téléphone": "0784 28 88 74", Email: "" },
    ["Golden Barber", "Kouba", "à confirmer", ""],
  ]);
  assert.deepEqual(dropped, [
    { name: "Or noir", column: "Téléphone", value: "0561 06 30 53" },
    { name: "Salon Dina", column: "Téléphone", value: "0555 00 00 00" },
    { name: "Salon Dina", column: "Email", value: "dina@invented.example" },
  ]);
  assert.match(droppedNote(dropped), /^NOT SAVED: 0561 06 30 53 \(Téléphone of "Or noir"\); .*Never write one from memory/);
  assert.equal(droppedNote([]), "");
});

test("only phone and email columns are checked: a year, a price or a reference is never taken out", () => {
  const { rows, dropped } = dropUnseen(["Name", "Year", "Price", "Reference"], [["A", "20241231", "12500000", "REF-99887766"]], read);
  assert.deepEqual(rows, [["A", "20241231", "12500000", "REF-99887766"]]);
  assert.equal(dropped.length, 0);
});
