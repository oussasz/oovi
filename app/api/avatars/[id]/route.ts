import { avatarPng } from "@/lib/avatars";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A marketplace picture for a bot's face (lib/avatars.ts). Not found = the face shows its slime.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  const png = await avatarPng((await params).id);
  if (!png) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
