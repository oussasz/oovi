// An AI picture for the user's oovi (lib/imagegen.ts). Body: {prompt, shape?: square|portrait|landscape}.
// Charged in credits at cost (a fraction of a credit). Refused when theOovi can't be used right now.
import { apiError, clientIp, getRequestSession, rateLimit } from "@/lib/api";
import { getAiConfig } from "@/lib/ai-config";
import { adjustCredits, creditStatus } from "@/lib/credits";
import { drawPicture, imageKey, PictureError } from "@/lib/imagegen";
import { pictureRefusal, pictureUsd, SIZES, type PictureShape } from "@/lib/imagegen-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`img:${session.user.id}`, 10, 60_000)) return apiError("Too many pictures at once. Wait a minute.", 429);
  const b = (await req.json().catch(() => null)) as { prompt?: unknown; shape?: unknown } | null;
  const prompt = typeof b?.prompt === "string" ? b.prompt.trim() : "";
  const why = pictureRefusal(prompt);
  if (why) return apiError(why, 400);
  const shape: PictureShape = typeof b?.shape === "string" && b.shape in SIZES ? (b.shape as PictureShape) : "square";
  const k = await imageKey();
  if (!k) return apiError("AI pictures aren't available yet.", 503);
  const u = session.user as { id: string; createdAt: Date | string; emailVerified?: boolean };
  const st = await creditStatus(u.id, u.createdAt, clientIp(req), u.emailVerified !== false);
  if (st.state !== "ok") return apiError(st.message ?? "theOovi can't be used right now.", 402);
  let image: string;
  try {
    image = await drawPicture(prompt, shape, k);
  } catch (err) {
    if (err instanceof PictureError) return apiError(err.message, err.status);
    return apiError("The picture couldn't be made. Try again in a moment.", 502);
  }
  const cfg = await getAiConfig();
  const credits = Math.max(0.1, Math.round(pictureUsd(shape) * cfg.creditsPerUsd * 10) / 10);
  await adjustCredits(u.id, -credits, "picture", `AI picture ${shape}`, null).catch(() => {});
  return Response.json({ image, mime: "image/jpeg", credits }, { headers: { "cache-control": "no-store" } });
}
