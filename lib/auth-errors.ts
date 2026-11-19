// Sign-in / sign-up / email-code errors from the account service (web/app/api/v1/auth/*), named so the app can
// show them in the user's language (components/AccountGate.tsx, keys auth.err.*). The service answers in English.
// Self-contained: unit-tested in tests/unit/auth-errors.test.mts.

export type AuthErrorCode =
  | "invalid"
  | "tooMany"
  | "resendWait"
  | "network"
  | "exists"
  | "verified"
  | "codeExpired"
  | "codeTooMany"
  | "codeWrong"
  | "email"
  | "password"
  | "terms"
  | "server";

/**
 * `status` is the account service's HTTP status (0: it couldn't be reached), `message` its English text.
 * Undefined when the text is better shown as it is (e.g. an account blocked by the admin, a name the service refused).
 */
export function authErrorCode(status: number, message = ""): AuthErrorCode | undefined {
  if (status === 0) return "network";
  if (status === 401) return "invalid";
  if (status === 429) return /few codes/i.test(message) ? "resendWait" : "tooMany";
  if (status === 409) return /confirmed/i.test(message) ? "verified" : "exists";
  if (/expired/i.test(message)) return "codeExpired";
  if (/too many wrong codes/i.test(message)) return "codeTooMany";
  if (/code isn't right|invalid otp/i.test(message)) return "codeWrong";
  if (/valid email/i.test(message)) return "email";
  if (/^password must be/i.test(message)) return "password";
  if (/terms of service/i.test(message)) return "terms";
  if (status >= 500) return "server";
  return undefined;
}
