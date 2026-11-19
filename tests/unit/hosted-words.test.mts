// theOovi's account errors reach Telegram, routine notices and the sign-in screen in the user's language, with the
// next step, never as the website's English (lib/hosted-words.ts, lib/auth-errors.ts). Telegram captions count as
// the message (lib/telegram-links.ts addressedText).
import test from "node:test";
import assert from "node:assert/strict";
import { hostedErrorText, untilMidnightUtc } from "../../lib/hosted-words.ts";
import { authErrorCode } from "../../lib/auth-errors.ts";
import { addressedText } from "../../lib/telegram-links.ts";
import en from "../../lib/i18n/en.ts";
import fr from "../../lib/i18n/fr.ts";
import ar from "../../lib/i18n/ar.ts";

const trOf = (dict: Record<string, string | undefined>) => (key: string, vars?: Record<string, string | number>) =>
  (dict[key] ?? (en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));

test("account errors: translated, with the next step, by errorCode", () => {
  const tAr = trOf(ar as Record<string, string>);
  const out = hostedErrorText(tAr as never, "no_credits", { away: true })!;
  assert.ok(out.startsWith(ar["credits.outTitle"]!), out);
  assert.ok(out.includes(ar["credits.fixInApp"]!), "says where to fix it when away from the app");
  assert.doesNotMatch(out, /[A-Za-z]{4,} [A-Za-z]{4,}/, "no English sentence in the Arabic text");

  const fr1 = hostedErrorText(trOf(fr as Record<string, string>) as never, "daily_limit", { now: Date.UTC(2026, 10, 19, 21, 30) })!;
  assert.match(fr1, /2 h 30 min/);
  assert.ok(!fr1.includes("{"), fr1);

  assert.equal(hostedErrorText(trOf(en) as never, "verify_email"), en["credits.verifyTitle"]);
  assert.equal(hostedErrorText(trOf(en) as never, "signed_out"), en["credits.signedOut"]);
  // Anything else stays the bot's own error text.
  assert.equal(hostedErrorText(trOf(en) as never, "busy"), null);
  assert.equal(hostedErrorText(trOf(en) as never, undefined), null);
});

test("daily limit resets at midnight UTC", () => {
  assert.deepEqual(untilMidnightUtc(Date.UTC(2026, 0, 1, 23, 59, 30)), { h: 0, m: 1 });
  assert.deepEqual(untilMidnightUtc(Date.UTC(2026, 0, 1, 0, 0, 0)), { h: 24, m: 0 });
});

test("sign-in errors are named by status and the service's words", () => {
  assert.equal(authErrorCode(0, "Can't reach the oovi account service."), "network");
  assert.equal(authErrorCode(401, "Invalid email or password."), "invalid");
  assert.equal(authErrorCode(429, "Too many attempts. Please try again in a minute."), "tooMany");
  assert.equal(authErrorCode(429, "You've asked for a few codes already. Please wait a few minutes"), "resendWait");
  assert.equal(authErrorCode(409, "An account with this email already exists."), "exists");
  assert.equal(authErrorCode(409, "Your email is confirmed. Sign in to continue."), "verified");
  assert.equal(authErrorCode(400, "This code has expired. Ask for a new one."), "codeExpired");
  assert.equal(authErrorCode(400, "That code isn't right. Check the latest email from oovi."), "codeWrong");
  assert.equal(authErrorCode(400, "Password must be between 8 and 128 characters."), "password");
  assert.equal(authErrorCode(502, "Account service error (502)."), "server");
  // A reason the service words itself (blocked account): shown as it is.
  assert.equal(authErrorCode(403, "This account is blocked."), undefined);
  for (const code of ["invalid", "tooMany", "resendWait", "network", "exists", "verified", "codeExpired", "codeTooMany", "codeWrong", "email", "password", "terms", "server"]) {
    for (const [name, dict] of [["en", en], ["fr", fr], ["ar", ar]] as const) assert.ok((dict as Record<string, string>)[`auth.err.${code}`], `${name} auth.err.${code}`);
  }
});

test("Telegram: a photo's caption is the message", () => {
  const chat = { id: 5, type: "private" };
  assert.equal(addressedText({ chat, caption: " what is this? ", photo: [{ file_id: "x" }] }), "what is this?");
  assert.equal(addressedText({ chat: { id: -9, type: "supergroup" }, caption: "@oovi_bot read this", document: { file_id: "y" } }, "oovi_bot"), "read this");
  assert.equal(addressedText({ chat: { id: -9, type: "supergroup" }, photo: [{ file_id: "x" }] }, "oovi_bot"), null);
});
