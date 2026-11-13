// A new confirmation email (code + link) for an account being opened. Signed out by nature, so the
// answer is the same whether the address has an account or not (nothing to learn from it).
import { auth } from "@/lib/auth";
import { apiError, clientIp, noContent, rateLimit, readJson } from "@/lib/api";
import { smtpStatus } from "@/lib/mail";
import { EMAIL_RE } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`resend-code:${clientIp(req)}`, 5, 10 * 60_000)) return apiError("You've asked for a few codes already. Please wait a few minutes, then check your inbox and spam folder.", 429);
  const body = await readJson(req, 4 * 1024);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return apiError("Please enter a valid email address.", 400);
  if (!(await smtpStatus()).ready) return apiError("Email isn't available right now.", 503);
  if (rateLimit(`verify-code:${email}`, 3, 10 * 60_000)) {
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: "/verified" } }).catch((e) => console.error("resend code failed", e instanceof Error ? e.message : "unknown error"));
  }
  return noContent();
}
