// An example of one email, for the console's preview frame. Admins only; strict CSP so
// the email HTML can't run scripts, load anything but images, or be framed elsewhere.
import { getAdmin } from "@/lib/admin";
import { previews } from "@/lib/mail-templates";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const admin = await getAdmin();
  if (!admin) return notFound();
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const all = previews(admin.email);
  if (!Object.prototype.hasOwnProperty.call(all, t)) return notFound();
  return new Response(all[t]!.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
