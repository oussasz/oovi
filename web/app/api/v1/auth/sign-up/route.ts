import { auth } from "@/lib/auth";
import {
  apiError,
  authHeaders,
  clientIp,
  describeAuthError,
  json,
  rateLimit,
  readJson,
  toPublicUser,
} from "@/lib/api";
import { TERMS_VERSION } from "@/lib/legal";
import { verificationRequired } from "@/lib/mail";
import { EMAIL_RE, MAX_PASSWORD, MIN_PASSWORD, validateName } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`signup:${clientIp(req)}`, 10)) {
    return apiError("Too many requests. Please try again in a minute.", 429);
  }
  const body = await readJson(req, 16 * 1024);
  if (!body) return apiError("Invalid JSON body.", 400);

  const { name, email, password, acceptTerms } = body;
  if (acceptTerms !== true) {
    return apiError("You must accept the Terms of Service and Privacy Policy.", 400);
  }
  const nameErr = validateName(name);
  if (nameErr) return apiError(nameErr, 400);
  if (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email.trim())) {
    return apiError("Please enter a valid email address.", 400);
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return apiError(`Password must be between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters.`, 400);
  }

  try {
    const via = authHeaders(req);
    via.set("x-oovi-via", "v1");
    const result = await auth.api.signUpEmail({
      headers: via,
      body: {
        name: (name as string).trim(),
        email: email.trim().toLowerCase(),
        password,
        termsVersion: TERMS_VERSION,
      },
    });
    if (!result.token) return apiError("Could not create a session.", 500);
    // Confirmation required: the account opens only once the email is confirmed. The email with the
    // code is already on its way (sendOnSignUp); the session made by the sign-up isn't handed out.
    // Only apps that can ask for the code say so (x-oovi-email-code); older versions keep the old way:
    // the account opens, and the email is confirmed later.
    if (req.headers.get("x-oovi-email-code") === "1" && (await verificationRequired())) {
      await auth.api.signOut({ headers: new Headers({ authorization: `Bearer ${result.token}` }) }).catch(() => {});
      return json({ verify: true, email: result.user.email }, 201);
    }
    return json({ token: result.token, user: toPublicUser(result.user) }, 201);
  } catch (err) {
    const { status, message, code } = describeAuthError(err);
    if (code?.startsWith("USER_ALREADY_EXISTS") || /already exists/i.test(message)) {
      return apiError("An account with this email already exists.", 409);
    }
    if (status >= 400 && status < 500) return apiError(message, 400);
    console.error("sign-up failed", err);
    return apiError("Could not create your account. Please try again.", 500);
  }
}
