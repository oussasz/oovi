import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import {
  CONSENT_TEXT, CONSENT_VERSION, MAX_SIGNATURE_BYTES, checkSignature, cleanProfileUrl, consentHash, ipHash, parseExpertForm, sameName,
} from "../../web/lib/expert-form.ts";

// A real PNG made here: width x height RGBA, all transparent, with `ink` opaque pixels in the first row.
function png(w: number, h: number, ink: number): Buffer {
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(stride * h);
  for (let i = 0; i < ink; i++) { raw[1 + i * 4] = 26; raw[2 + i * 4] = 26; raw[3 + i * 4] = 26; raw[4 + i * 4] = 255; }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const url = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

test("a drawn signature is accepted; a blank one, a non-PNG, an oversized one and a wrong prefix are not", () => {
  assert.equal(checkSignature(url(png(600, 200, 40))).ok, true);
  const blank = checkSignature(url(png(600, 200, 0)));
  assert.ok(!blank.ok && /draw your signature/i.test(blank.error));
  assert.equal(checkSignature(url(Buffer.from("not a picture at all, just text that is long enough to pass the length check 123456789"))).ok, false);
  assert.equal(checkSignature(url(png(2000, 100, 5))).ok, false, "too many pixels");
  assert.equal(checkSignature("data:image/jpeg;base64," + png(600, 200, 40).toString("base64")).ok, false);
  assert.equal(checkSignature("data:image/png;base64,@@@").ok, false);
  assert.equal(checkSignature("https://evil.test/x.png").ok, false);
  const big = Buffer.concat([png(600, 200, 40), Buffer.alloc(MAX_SIGNATURE_BYTES)]);
  assert.equal(checkSignature(url(big)).ok, false, "over the size cap");
  // a PNG cut short is refused, not crashed on
  assert.equal(checkSignature(url(png(600, 200, 40).subarray(0, 70))).ok, false);
});

const good = (over: Record<string, string | string[]> = {}) => {
  const base: Record<string, string | string[]> = {
    name: "Jane Doe", email: "Jane@Example.com ", profileUrl: "https://www.linkedin.com/in/jane", field: "Startups", bio: "I help founders find their first customers.",
    languages: ["fr", "en", "klingon"], knownAs: "", signedName: "jane  doe", consent: "on", consentVersion: CONSENT_VERSION, signature: url(png(600, 200, 30)),
  };
  const all = { ...base, ...over };
  return (k: string) => all[k] ?? null;
};

test("a complete request is accepted and cleaned", () => {
  const r = parseExpertForm(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.value!.email, "jane@example.com");
  assert.deepEqual(r.value!.languages, ["fr", "en"], "unknown languages are dropped");
  assert.ok(r.value!.signature && r.value!.signature.length > 60);
  assert.equal(r.honeypot, false);
});

test("every missing or wrong thing is named in plain words", () => {
  const miss = (over: Record<string, string | string[]>, re: RegExp) => {
    const r = parseExpertForm(good(over));
    assert.equal(r.value, null);
    assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(over).slice(0, 60)} -> ${r.errors.join(" | ")}`);
  };
  miss({ name: "J" }, /full name/);
  miss({ email: "nope" }, /email/);
  miss({ profileUrl: "http://linkedin.com/in/x" }, /https/);
  miss({ profileUrl: "javascript:alert(1)" }, /https/);
  miss({ field: "" }, /expert in/);
  miss({ bio: "short" }, /bio/);
  miss({ bio: "x".repeat(601) }, /bio/);
  miss({ languages: [] }, /language/);
  miss({ consent: "" }, /agree/);
  miss({ consentVersion: "old" }, /updated/);
  miss({ signedName: "" }, /Type your full name/);
  miss({ signedName: "Somebody Else" }, /same as your full name/);
  miss({ signature: "" }, /draw your signature/i);
});

test("people who can't draw sign with their typed name; a trap field drops the request", () => {
  const r = parseExpertForm(good({ signature: "", typedOnly: "on" }));
  assert.deepEqual(r.errors, []);
  assert.equal(r.value!.signature, null);
  assert.equal(r.value!.typedOnly, true);
  assert.equal(parseExpertForm(good({ website: "http://spam" })).honeypot, true);
});

test("the consent text is versioned and hashed: any change to the words changes the hash", () => {
  assert.match(CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}-\d+$/);
  assert.equal(consentHash(), consentHash(CONSENT_TEXT));
  assert.notEqual(consentHash(), consentHash([...CONSENT_TEXT.slice(0, -1), "Changed."]));
  assert.match(consentHash(), /^[0-9a-f]{64}$/);
  // it says what it must say, and promises nothing it must not
  const all = CONSENT_TEXT.join(" ").toLowerCase();
  assert.ok(all.includes("not a contract") && all.includes("in writing") && all.includes("withdraw"));
  assert.ok(!/revenue|exclusiv|governing law|royalt|commission/.test(all));
});

test("the IP is only ever stored as a salted hash", () => {
  const h = ipHash("203.0.113.9", "s1");
  assert.match(h!, /^[0-9a-f]{32}$/);
  assert.ok(!h!.includes("203"));
  assert.notEqual(h, ipHash("203.0.113.9", "s2"));
  assert.equal(ipHash(null), null);
});

test("small helpers: links must be https, names compare without case or extra spaces", () => {
  assert.equal(cleanProfileUrl("https://a.com/x"), "https://a.com/x");
  assert.equal(cleanProfileUrl("https://user:pw@a.com/"), null);
  assert.equal(cleanProfileUrl("https://localhost/"), null);
  assert.ok(sameName("  Jane   DOE", "jane doe"));
});
