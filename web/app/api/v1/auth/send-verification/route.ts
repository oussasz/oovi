// Sends a fresh "Confirm your email" link to the signed-in person (desktop app with a
// Bearer token, or the website with its cookie). Only ever to their own address.
import { apiError, getRequestSession, json, noContent, rateLimit } from "@/lib/api";
import { auth } from "@/lib/auth";
import { smtpStatus } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  if (session.user.emailVerified) return json({ alreadyVerified: true });
  if (!rateLimit(`verify-mail:${session.user.id}`, 3, 10 * 60_000)) {
    return apiError("You've asked for a few links already. Please wait a few minutes, then check your inbox and spam folder.", 429);
  }
  if (!(await smtpStatus()).ready) return apiError("Email isn't available right now.", 503);
  try {
    await auth.api.sendVerificationEmail({ body: { email: session.user.email, callbackURL: "/verified" } });
  } catch (err) {
    console.error("send verification failed", err instanceof Error ? err.message : "unknown error");
    return apiError("Couldn't send the email. Please try again in a moment.", 500);
  }
  return noContent();
}
