// Is Paddle set up on the server? Answers with yes/no facts only (never a key or secret), so the
// setup can be checked after changing environment variables. Cached for 10 minutes so it can't be
// used to spend the API key's rate limit.
import { paddleEnvironment } from "@/lib/paddle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What "Manage billing" needs. */
const NEEDED = ["customer_portal_session.write", "customer.read", "subscription.read"];
const TTL = 10 * 60_000;
const g = globalThis as typeof globalThis & { __ooviPaddleHealth?: { at: number; body: unknown } };

async function check() {
  let environment: string;
  try {
    environment = paddleEnvironment();
  } catch {
    return { ok: false, environment: null, webhookSecret: !!process.env.PADDLE_WEBHOOK_SECRET, apiKey: "environment not set" };
  }
  const webhookSecret = !!process.env.PADDLE_WEBHOOK_SECRET;
  const key = process.env.PADDLE_API_KEY;
  if (!key) return { ok: false, environment, webhookSecret, apiKey: "missing" };
  const live = environment === "production";
  if (live ? !key.startsWith("pdl_live_") : !key.startsWith("pdl_sdbx_")) {
    return { ok: false, environment, webhookSecret, apiKey: `not a ${live ? "live" : "sandbox"} key` };
  }
  try {
    const res = await fetch(live ? "https://api.paddle.com/" : "https://sandbox-api.paddle.com/", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, environment, webhookSecret, apiKey: `rejected by Paddle (HTTP ${res.status})` };
    const body = (await res.json()) as { data?: { caller?: { account?: unknown; permissions?: string[] } } };
    if (!body.data?.caller?.account) return { ok: false, environment, webhookSecret, apiKey: "rejected by Paddle" };
    const perms = body.data.caller.permissions ?? [];
    const missing = NEEDED.filter((p) => !perms.includes(p) && !perms.includes(p.replace(/\.read$/, ".write")));
    return { ok: webhookSecret && missing.length === 0, environment, webhookSecret, apiKey: "valid", missingPermissions: missing };
  } catch {
    return { ok: false, environment, webhookSecret, apiKey: "Paddle didn't answer" };
  }
}

export async function GET() {
  const c = g.__ooviPaddleHealth;
  if (c && Date.now() - c.at < TTL) return Response.json(c.body);
  const body = await check();
  g.__ooviPaddleHealth = { at: Date.now(), body };
  return Response.json(body);
}
