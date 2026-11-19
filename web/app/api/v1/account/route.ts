// The account part of the web app's Settings (it was the website's /account page): whether the email is
// confirmed (and an email can be sent), the Paddle subscription's status, and "News by email".
// Signed in only; everything comes from the session's own account. Name, photo: PATCH /api/v1/me. Password and
// deleting the account: Better Auth (current password asked). Billing: POST /api/billing/portal (Paddle).
import { apiError, getRequestSession, json, readJson } from "@/lib/api";
import { newsOptedOut, setNewsOptOut } from "@/lib/announcements";
import { billingFor } from "@/lib/billing";
import { smtpStatus } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  const userId = session.user.id;
  // Each part is optional, like on the old page: a failure leaves the rest.
  const [billing, newsOut, mailReady] = await Promise.all([
    billingFor(userId).catch((err) => {
      console.error("account billing failed", err instanceof Error ? err.message : err);
      return null;
    }),
    newsOptedOut(userId).catch(() => false),
    smtpStatus()
      .then((s) => s.ready)
      .catch(() => false),
  ]);
  const emailVerified = !!session.user.emailVerified;
  return json({
    emailVerified,
    // Ask to confirm only when an email can actually be sent.
    askToVerify: !emailVerified && mailReady,
    // null: never subscribed (free plan). Only the status leaves the server, never Paddle ids.
    billing: billing ? { status: billing.status } : null,
    news: !newsOut,
  });
}

/** {news: boolean}: "News by email" on or off. */
export async function PATCH(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return apiError("Forbidden origin.", 403);
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  const body = await readJson(req, 1024);
  if (!body || typeof body.news !== "boolean") return apiError("Send {news: true|false}.", 400);
  await setNewsOptOut(session.user.id, !body.news);
  return json({ news: body.news });
}
