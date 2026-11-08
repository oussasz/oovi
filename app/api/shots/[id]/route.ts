import { guard } from "@/lib/guard";
import { readShot } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const img = readShot((await params).id);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
}
