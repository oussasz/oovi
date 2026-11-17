// Replies that stop on a promise (lib/promise-core.ts), in English, French, Arabic and Darija.
import test from "node:test";
import assert from "node:assert/strict";
import { endsOnPromise, lastSentence } from "../../lib/promise-core.ts";

test("a reply ending on work it announces is caught", () => {
  for (const t of [
    "I found 12 cafés so far. I'll get the phone numbers for the rest now.",
    "Got it. Let me search for more suppliers in Oran.",
    "J'ai trouvé 5 contacts. Je vais chercher les autres maintenant.",
    "تمام، سأبحث عن باقي المقاهي الآن.",
    "مليح، راني نحوس على الباقي.",
    "واش حبيت راهو. درك نكمل القائمة",
  ])
    assert.ok(endsOnPromise(t), t);
});

test("a reply that waits for the user, or is finished, is not a promise", () => {
  for (const t of [
    "Here are the 20 cafés with their phones. Let me know if you want more.",
    "I'll wait for your answer before sending it.",
    "Should I send the email now?",
    "Voulez-vous que je l'envoie ?",
    "هل تريد أن أرسلها الآن؟",
    "ايلا حبيت نزيدلك، قولي.",
    "Done: the file is in Downloads/oovi.",
    "",
    "I will be happy to help with that if you want.",
  ])
    assert.equal(endsOnPromise(t), null, t);
});

test("only the end counts", () => {
  assert.equal(endsOnPromise("I'll check the prices. Here they are: 12 DA, 15 DA, 20 DA."), null);
  assert.equal(lastSentence("First line\n\nSecond. Third one!  "), "Third one!");
});
