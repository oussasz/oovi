// How oovi reads what users write, in the languages they use: Arabic, Algerian Darija (in Arabic letters and
// in Latin letters with numbers, "3tini", "wach"), French, English and mixes. One table of real-style messages
// per rule. Add a line here for every message a rule got wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { replyLanguage } from "../../lib/text-locale.ts";
import { claimedAction } from "../../lib/receipts-core.ts";
import { endsOnPromise } from "../../lib/promise-core.ts";
import { unbackedFact } from "../../lib/memory-evidence-core.ts";
import { fold, searchChats } from "../../lib/chat-basics-core.ts";

const lang = (t: string) => (replyLanguage(t) ?? "?").split(" ")[0]!;

test("reply language", () => {
  const cases: [string, string][] = [
    ["أعطني قائمة المقاهي في وهران", "Arabic"],
    ["عطيني ليستة تاع الكافيات في وهران", "Arabic"],
    ["سلام، واش تقدر تبعثلي الإيمايل؟", "Arabic"],
    ["Trouve-moi les cafés à Oran avec leurs numéros", "French"],
    ["Envoie le fichier à Karim stp", "French"],
    ["Find me cafes in Oran with phone numbers", "English"],
    ["Can you send the file to Karim please", "English"],
    ["3tini la liste ta3 les cafés f Wahran", "Darija"],
    ["wach t9der tb3tli l email l Karim", "Darija"],
    ["rani nhawes 3la des clients f Alger, khdem liya liste", "Darija"],
    ["salam khoya, kifach ndir facture?", "Darija"],
    ["bghit n3ref chhal kayen men pharmacie f Blida", "Darija"],
    ["merci bzaf sahbi", "Darija"],
  ];
  for (const [t, want] of cases) assert.equal(lang(t), want, t);
});

test("'sent / booked' claims (for the Not confirmed mark)", () => {
  const yes = [
    "I've sent the email to Karim.",
    "J'ai envoyé le message à Karim.",
    "La réservation a été confirmée et le mail a été envoyé.",
    "تم إرسال البريد إلى كريم.",
    "بعثتلك الإيمايل.",
    "sayfatlek l email l Karim.",
    "rani b3athtlek el message.",
    "c bon, b3atht l email.",
  ];
  const no = ["Shall I send it?", "Voulez-vous que je l'envoie ?", "واش نبعثو؟", "nb3athlek l email?", "I will send it after you check.", "Here is the draft to send."];
  for (const t of yes) assert.ok(claimedAction(t), `claim not seen: ${t}`);
  for (const t of no) assert.equal(claimedAction(t), null, `not a claim: ${t}`);
});

test("ending on a promise (sent back once to do it)", () => {
  const yes = ["Je vais chercher les numéros maintenant.", "سأبحث عن الأرقام الآن.", "راني نحوس على الأرقام.", "drok nhawes 3la les numéros.", "rani nbda f el recherche.", "I'll search for the numbers now."];
  const no = ["Voulez-vous que je cherche aussi à Blida ?", "ايلا حبيت نزيد بليدة قولي.", "Here are the 20 cafés.", "dir liya OK w nkemmel?", "Let me know if you want more."];
  for (const t of yes) assert.ok(endsOnPromise(t), `promise not seen: ${t}`);
  for (const t of no) assert.ok(!endsOnPromise(t), `not a promise: ${t}`);
});

test("facts about the user keep their numbers as written (spaces, dots, Arabic digits)", () => {
  assert.equal(unbackedFact("Phone: 0555123456", "noumrou ta3i 0555 12 34 56"), null);
  assert.equal(unbackedFact("Phone: 0555 12 34 56", "رقمي 0555.12.34.56"), null);
  assert.equal(unbackedFact("Phone: 0555123456", "رقمي ٠٥٥٥١٢٣٤٥٦"), null);
  assert.ok(unbackedFact("Phone: 0555123457", "رقمي ٠٥٥٥١٢٣٤٥٦"));
});

test("search folds Arabic letter forms, French accents and Latin Darija as typed", () => {
  assert.equal(fold("إيمايل"), fold("ايمايل"));
  assert.equal(fold("Réunion"), "reunion");
  const chats = [{ id: "c", kind: "direct", name: "", memberIds: [], createdAt: 0, updatedAt: 0, entries: [{ id: "e", kind: "user", text: "الفاتورة تاع شهر نوفمبر", at: 1 }] }] as never;
  assert.equal(searchChats(chats, "فاتوره", () => "").length, 1);
});
