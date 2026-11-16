// The drawn signature of one application, as an image. Admins only (anyone else gets a plain 404).
import { getAdmin } from "@/lib/admin";
import { getSignature } from "@/lib/expert-db";
import { ID_RE } from "@/lib/form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  const png = ID_RE.test(id) ? await getSignature(id).catch(() => null) : null;
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex",
    },
  });
}
