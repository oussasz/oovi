// A marketplace picture for a bot's face (lib/avatars.ts). Public, like the marketplace itself: the apps
// download it once and keep it. An id is the md5 of the bytes, so the answer never changes.
import { getAvatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const png = await getAvatar(id).catch(() => null);
  if (!png) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
