// Protection against fake and mass sign-ups, for every way of creating an account (website form,
// app). Runs in the auth library's "before a user is created" hook (lib/auth.ts):
// - throwaway email services are refused (mailinator and the like),
// - a network (a salted hash of the IP, never the IP itself) can create only a few accounts per
//   hour and per day. The counts live in the database, so they hold across Vercel's servers.
// The website form is also checked by Vercel BotID (app/api/auth/[...all]/route.ts).
import crypto from "node:crypto";
import { pool } from "./db";

/** Accounts one network may create. Generous on purpose: mobile carriers put many people behind one IP. */
export const SIGNUPS_PER_HOUR = 5;
export const SIGNUPS_PER_DAY = 15;

/** Common disposable-email services. Lowercase domains; subdomains match too. */
const DISPOSABLE = new Set(
  (
    "mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net " +
    "tempmail.com temp-mail.org temp-mail.io tempmail.net tempmailo.com tempr.email tmpmail.org tmpmail.net yopmail.com yopmail.fr yopmail.net " +
    "trashmail.com trashmail.de trashmail.net getnada.com nada.email dispostable.com maildrop.cc mailnesia.com mintemail.com " +
    "throwawaymail.com fakeinbox.com spamgourmet.com mohmal.com emailondeck.com mailcatch.com moakt.com tempinbox.com " +
    "burnermail.io mail.tm mail.gw inboxkitten.com mailpoof.com discard.email spam4.me 1secmail.com 1secmail.net 1secmail.org " +
    "emailfake.com fakemail.net email-temp.com tempmailaddress.com dropmail.me minuteinbox.com harakirimail.com " +
    "mytemp.email tempail.com luxusmail.org cuvox.de armyspy.com dayrep.com einrot.com fleckens.hu gustr.com jourrapide.com " +
    "rhyta.com superrito.com teleworm.us"
  ).split(/\s+/),
);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  return false;
}

/** The first address in x-forwarded-for (set by Vercel), else x-real-ip. */
export function ipFrom(headers: Headers | undefined | null): string | null {
  const fwd = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers?.get("x-real-ip")?.trim() || null;
}

function networkKey(ip: string): string {
  return crypto.createHash("sha256").update(`oovi-signup:${process.env.BETTER_AUTH_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

let tableReady: Promise<unknown> | null = null;
const ensureTable = () =>
  (tableReady ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS signup_attempts (
         id bigserial PRIMARY KEY,
         network text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now()
       );
       CREATE INDEX IF NOT EXISTS signup_attempts_network_time ON signup_attempts (network, created_at);`,
    )
    .catch((e) => {
      tableReady = null;
      throw e;
    }));

export type SignupVerdict = { ok: true } | { ok: false; message: string };

/** Whether this sign-up may go ahead. Counts it when it does. Never blocks because of our own database error. */
export async function checkSignup(email: string, headers: Headers | undefined | null): Promise<SignupVerdict> {
  if (isDisposableEmail(email)) {
    return { ok: false, message: "Please use your usual email address. Temporary email services can't be used for an oovi account." };
  }
  const ip = ipFrom(headers);
  if (!ip) return { ok: true };
  const net = networkKey(ip);
  try {
    await ensureTable();
    const { rows } = await pool.query<{ hour: string; day: string }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::text AS hour, count(*)::text AS day
         FROM signup_attempts WHERE network = $1 AND created_at > now() - interval '1 day'`,
      [net],
    );
    const hour = Number(rows[0]?.hour ?? 0);
    const day = Number(rows[0]?.day ?? 0);
    if (hour >= SIGNUPS_PER_HOUR || day >= SIGNUPS_PER_DAY) {
      return { ok: false, message: "Too many accounts were created from this network recently. Please try again later, or write to contact@conuron.com." };
    }
    await pool.query("INSERT INTO signup_attempts (network) VALUES ($1)", [net]);
    // Old rows aren't needed after a day.
    if (Math.random() < 0.02) await pool.query("DELETE FROM signup_attempts WHERE created_at < now() - interval '2 days'");
  } catch (err) {
    console.error("[signup-guard] check failed, letting the sign-up through", err instanceof Error ? err.message : err);
  }
  return { ok: true };
}
