// POST {png: base64}: a picture the signed-in user gave one of their own bots (the app's "Your picture"), kept for
// their phone, the web app and their other computers (lib/avatars.ts saveUserAvatar). Read back with
// GET /api/v1/avatars/<id>, like the marketplace pictures.
import { apiError, getRequestSession, rateLimit } from "@/lib/api";
import { MAX_AVATAR_BYTES, isAvatarPng, saveUserAvatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`avatars:put:${session.user.id}`, 60, 10 * 60_000)) return apiError("Too many pictures at once. Try again in a few minutes.", 429);
  let png: Buffer;
  try {
    const text = await req.text();
    if (text.length > MAX_AVATAR_BYTES * 1.4 + 200) return apiError("This picture is too big.", 413);
    const b = JSON.parse(text) as { png?: unknown };
    png = Buffer.from(String(b.png ?? "").replace(/^data:image\/png;base64,/, ""), "base64");
  } catch {
    return apiError("Invalid request.", 400);
  }
  if (!isAvatarPng(png)) return apiError("Use a PNG picture.", 400);
  try {
    const r = await saveUserAvatar(png, session.user.id);
    if (r === "full") return apiError("Too many pictures on this account.", 413);
    return Response.json(r, { status: 201 });
  } catch (err) {
    console.error("avatar save failed", err instanceof Error ? err.message : err);
    return apiError("The picture could not be saved right now.", 503);
  }
}
