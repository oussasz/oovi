// The signed-in user's oovi setup for their other computers (lib/account-setup.ts).
import { apiError, getRequestSession, rateLimit } from "@/lib/api";
import { MAX_SETUP_BYTES, readSetup, writeSetup } from "@/lib/account-setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`setup:get:${session.user.id}`, 60, 10 * 60_000)) return apiError("Too many requests. Try again in a few minutes.", 429);
  try {
    return Response.json(await readSetup(session.user.id), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("setup read failed", err instanceof Error ? err.message : err);
    return apiError("Your setup could not be read right now.", 503);
  }
}

/** {baseVersion, items}: 409 when another computer saved first (the app merges again). */
export async function PUT(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`setup:put:${session.user.id}`, 40, 10 * 60_000)) return apiError("Too many requests. Try again in a few minutes.", 429);
  let body: { baseVersion?: unknown; items?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_SETUP_BYTES) return apiError("Your setup is too big to keep (over 8 MB).", 413);
    body = JSON.parse(text) as typeof body;
  } catch {
    return apiError("Invalid request.", 400);
  }
  const base = Number(body.baseVersion);
  const items = body.items;
  if (!Number.isInteger(base) || base < 0 || !items || typeof items !== "object" || Array.isArray(items)) return apiError("Invalid request.", 400);
  if (Object.keys(items).length > 20_000 || Object.keys(items).some((k) => !/^[a-z]+(:[\w.-]{1,100})?$/.test(k))) return apiError("Invalid setup.", 400);
  try {
    const r = await writeSetup(session.user.id, base, items as Record<string, unknown>);
    if (r === "conflict") return apiError("Your setup changed on another computer. Merging again.", 409);
    return Response.json(r);
  } catch (err) {
    console.error("setup save failed", err instanceof Error ? err.message : err);
    return apiError("Your setup could not be saved right now.", 503);
  }
}
