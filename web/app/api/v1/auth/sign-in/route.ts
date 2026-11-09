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

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`signin:${clientIp(req)}`, 20)) {
    return apiError("Too many attempts. Please try again in a minute.", 429);
  }
  const body = await readJson(req, 16 * 1024);
  if (!body) return apiError("Invalid JSON body.", 400);
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return apiError("Email and password are required.", 400);
  }

  try {
    const result = await auth.api.signInEmail({
      headers: authHeaders(req),
      body: { email: email.trim().toLowerCase(), password },
    });
    if (!result.token) return apiError("Could not create a session.", 500);
    return json({ token: result.token, user: toPublicUser(result.user) }, 200);
  } catch (err) {
    const { status, message } = describeAuthError(err);
    // Accounts blocked in the admin console get a clear reason instead of "wrong password".
    if (status === 403 && /blocked/i.test(message)) return apiError(message, 403);
    if (status === 401 || status === 400 || status === 403) {
      return apiError("Invalid email or password.", 401);
    }
    if (status === 429) return apiError("Too many attempts. Please try again later.", 429);
    console.error("sign-in failed", err);
    return apiError("Could not sign you in. Please try again.", 500);
  }
}
