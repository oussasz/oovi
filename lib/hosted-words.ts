// theOovi's account errors (out of credits, daily limit, signed out, email not confirmed, offline) in the user's
// words, for places without the app's HostedNotice card: Telegram replies and routine notices. The website's
// own message is English only (web/lib/credits.ts), so these go by the entry's errorCode instead.
// Self-contained (type imports only): unit-tested in tests/unit/hosted-words.test.mts.
import type { TKey, Vars } from "./i18n";

type Tr = (key: TKey, vars?: Vars) => string;

/** Hours and minutes until the daily limit resets (midnight UTC, as the website counts it). */
export function untilMidnightUtc(now = Date.now()): { h: number; m: number } {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const mins = Math.max(0, Math.ceil((next - now) / 60_000));
  return { h: Math.floor(mins / 60), m: mins % 60 };
}

/**
 * The translated text with the next step for a theOovi error code, or null for any other error (shown as it is).
 * `away`: the user isn't in the app (Telegram, a notification), so the steps that need the app say where to do them.
 */
export function hostedErrorText(tr: Tr, code: string | undefined, opts: { away?: boolean; now?: number } = {}): string | null {
  const where = opts.away ? ` ${tr("credits.fixInApp")}` : "";
  switch (code) {
    case "no_credits":
      return `${tr("credits.outTitle")}${where}`;
    case "daily_limit": {
      const { h, m } = untilMidnightUtc(opts.now);
      return `${tr("credits.limitTitle", { h, m })}${where}`;
    }
    case "signed_out":
      return `${tr("credits.signedOut")}${where}`;
    case "verify_email":
      return tr("credits.verifyTitle");
    case "offline":
      return tr("credits.offlineTitle");
    case "tls":
      return tr("credits.tlsTitle");
    default:
      return null;
  }
}
