// Two-step codes and saved-login sites (lib/totp-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { base32, keyFromSetup, siteMatches, siteOf, totp } from "../../lib/totp-core.ts";

test("RFC 6238 test vectors (SHA-1, 8 digits)", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(totp(key, 59_000, 8), "94287082");
  assert.equal(totp(key, 1111111109_000, 8), "07081804");
  assert.equal(totp(key, 2000000000_000, 8), "69279037");
});

test("base32 setup keys and otpauth links", () => {
  assert.deepEqual(base32("GEZDGNBVGY3TQOJQ"), Buffer.from("1234567890"));
  assert.deepEqual(base32("gezd gnbv-gy3t qojq"), Buffer.from("1234567890"));
  assert.equal(base32("not base32!"), null);
  assert.equal(keyFromSetup("otpauth://totp/Site:me?secret=JBSWY3DPEHPK3PXP&issuer=Site"), "JBSWY3DPEHPK3PXP");
  assert.equal(keyFromSetup("JBSW Y3DP EHPK 3PXP"), "JBSWY3DPEHPK3PXP");
  assert.equal(totp(base32("JBSWY3DPEHPK3PXP")!, 0).length, 6);
});

test("sites", () => {
  assert.equal(siteOf("https://www.facebook.com/login?x=1"), "facebook.com");
  assert.equal(siteOf("accounts.google.com"), "accounts.google.com");
  assert.equal(siteOf("not a site"), null);
  assert.ok(siteMatches("www.facebook.com", "facebook.com"));
  assert.ok(siteMatches("m.facebook.com", "facebook.com"));
  assert.equal(siteMatches("facebook.com.evil.test", "facebook.com"), false);
  assert.equal(siteMatches("notfacebook.com", "facebook.com"), false);
});
