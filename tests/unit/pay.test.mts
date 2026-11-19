// Paying from inside the app (web/lib/pay-core.ts): what the app may ask for, and the pages' languages.
import test from "node:test";
import assert from "node:assert/strict";
import { checkLinkRequest, PAY_LINK_SECONDS, PAY_TEXT, payLang, TOKEN_RE } from "../../web/lib/pay-core.ts";

const PRICES = { starter: { month: "pri_sm", year: "pri_sy" }, pro: { month: "pri_pm", year: "pri_py" } };

test("a link is a checkout (any plan, or one plan the site sells) or the portal", () => {
  assert.deepEqual(checkLinkRequest({ kind: "portal" }, PRICES), { kind: "portal" });
  assert.deepEqual(checkLinkRequest({ kind: "checkout" }, PRICES), { kind: "checkout", priceId: null });
  assert.deepEqual(checkLinkRequest({ kind: "checkout", plan: "pro" }, PRICES), { kind: "checkout", priceId: "pri_pm" });
  assert.deepEqual(checkLinkRequest({ kind: "checkout", plan: "pro", cycle: "year" }, PRICES), { kind: "checkout", priceId: "pri_py" });
  assert.deepEqual(checkLinkRequest({ kind: "checkout", priceId: "pri_sy" }, PRICES), { kind: "checkout", priceId: "pri_sy" });
  for (const bad of [null, [], "checkout", { kind: "refund" }, { kind: "checkout", plan: "gold" }, { kind: "checkout", plan: "pro", cycle: "week" }, { kind: "checkout", priceId: "pri_made_up" }, { kind: "checkout", credits: 500 }, { kind: "checkout", plan: "__proto__" }, { kind: "checkout", plan: "toString" }]) {
    assert.equal(typeof checkLinkRequest(bad, PRICES), "string", JSON.stringify(bad));
  }
});

test("links last 10 minutes; tokens are 32 random bytes in base64url", () => {
  assert.equal(PAY_LINK_SECONDS, 600);
  assert.ok(TOKEN_RE.test(Buffer.alloc(32, 7).toString("base64url")));
  assert.ok(!TOKEN_RE.test("short") && !TOKEN_RE.test("a".repeat(43) + "/"));
});

test("pages in Arabic, French or English, naming the app's own button", () => {
  assert.equal(payLang("fr-FR,fr;q=0.9"), "fr");
  assert.equal(payLang("ar-DZ"), "ar");
  assert.equal(payLang("de"), "en");
  assert.equal(payLang(null), "en");
  assert.ok(PAY_TEXT.en.gone.includes("Subscribe") && PAY_TEXT.fr.gone.includes("S'abonner") && PAY_TEXT.ar.gone.includes("اشترك"));
  for (const l of ["en", "fr", "ar"] as const) assert.ok(PAY_TEXT[l].checkoutLead.includes("{email}"));
});
