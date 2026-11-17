// "Not confirmed" marks (lib/receipts-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { claimedAction, unconfirmedClaim } from "../../lib/receipts-core.ts";

const turn = (name: string, ok = true) => [
  { role: "assistant" as const, text: "", toolCalls: [{ id: "1", name, input: {} }] },
  { role: "tool" as const, results: [{ id: "1", name, content: ok ? "ok" : "error", ...(ok ? {} : { isError: true }) }] },
];

test("a claim of sending, posting, booking or paying is found in four languages", () => {
  for (const t of ["Done! I sent the email to Karim.", "I've posted it on your Facebook page.", "J'ai envoyé le message au fournisseur.", "تم الإرسال إلى العميل.", "بعثتلك الملف في الإيميل"]) assert.ok(claimedAction(t), t);
});

test("questions, plans and conditions are not claims", () => {
  for (const t of ["Should I send the email now?", "I will send it when you confirm.", "If you want, I sent… no wait, shall I send it?", "Voulez-vous que je l'envoie ?", "هل أرسلها الآن؟", "Here are the 10 cafés with their phones."]) assert.equal(claimedAction(t), null, t);
});

test("a claim with an action behind it is confirmed; without, it is marked", () => {
  const text = "I sent the email to Karim.";
  assert.ok(unconfirmedClaim(text, []));
  assert.ok(unconfirmedClaim(text, turn("read_url")), "reading doesn't send");
  assert.ok(unconfirmedClaim(text, turn("mcp_gmail_send_email", false)), "a failed send doesn't count");
  assert.equal(unconfirmedClaim(text, turn("mcp_gmail_send_email")), null);
  assert.equal(unconfirmedClaim(text, turn("click")), null);
  assert.equal(unconfirmedClaim("Here is your summary.", []), null);
});
