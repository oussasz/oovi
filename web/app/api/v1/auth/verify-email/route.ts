// The 6-digit code from the confirmation email, typed in the sign-up form of the app (or the website).
// A right code confirms the email and opens the account: it returns a session, like signing in.
import { auth } from "@/lib/auth";
import { apiError, authHeaders, clientIp, describeAuthError, json, rateLimit, readJson, toPublicUser } from "@/lib/api";
import { EMAIL_RE } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`verify-email:${clientIp(req)}`, 20)) return apiError("Too many attempts. Please try again in a minute.", 429);
  const body = await readJson(req, 4 * 1024);
  if (!body) return apiError("Invalid request.", 400);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!EMAIL_RE.test(email)) return apiError("Please enter a valid email address.", 400);
  if (!/^\d{6}$/.test(code)) return apiError("The code has 6 digits.", 400);
  try {
    const r = await auth.api.verifyEmailOTP({ headers: authHeaders(req), body: { email, otp: code } });
    if (!r.token) return apiError("Your email is confirmed. Sign in to continue.", 409);
    return json({ token: r.token, user: toPublicUser(r.user) }, 200);
  } catch (err) {
    const { message } = describeAuthError(err);
    if (/expired/i.test(message)) return apiError("This code has expired. Ask for a new one.", 400);
    if (/too many/i.test(message)) return apiError("Too many wrong codes. Ask for a new one.", 400);
    if (/invalid otp|invalid/i.test(message)) return apiError("That code isn't right. Check the latest email from oovi.", 400);
    console.error("verify email failed", err instanceof Error ? err.message : "unknown error");
    return apiError("Couldn't check the code. Please try again.", 500);
  }
}
