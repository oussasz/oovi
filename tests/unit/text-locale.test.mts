import { test } from "node:test";
import assert from "node:assert/strict";
import { localeOfText } from "../../lib/text-locale.ts";

test("Arabic script, Darija included, is Arabic", () => {
  assert.equal(localeOfText("وش اخر شيئ تم تحميلو"), "ar");
  assert.equal(localeOfText("اهلا قولي حاليا وش راه مشغل فحاسوبط"), "ar");
  assert.equal(localeOfText("ابعثلي le fichier PDF"), "ar"); // mostly Arabic
});

test("clear French is French; English and unclear text are left to the app language", () => {
  assert.equal(localeOfText("Est-ce que tu peux m'envoyer le fichier ?"), "fr");
  assert.equal(localeOfText("Où est mon dossier"), "fr");
  assert.equal(localeOfText("what was the last thing I downloaded"), null);
  assert.equal(localeOfText("/yes"), null);
  assert.equal(localeOfText("wesh rak"), null); // Darija in Latin letters: the app language decides
  assert.equal(localeOfText(""), null);
});
