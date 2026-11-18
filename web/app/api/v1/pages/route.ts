// The app shares a Canvas page (POST {id?, title, content}) → {id, url}, or stops sharing it (DELETE ?id=).
import { apiError, getRequestSession } from "@/lib/api";
import { deletePage, savePage } from "@/lib/public-pages";
import { ID_RE, validatePage } from "@/lib/public-pages-core";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const raw = await req.text();
  if (raw.length > 3_000_000) return apiError("The page is too big to share.", 413);
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return apiError("Bad page.", 400);
  }
  const page = validatePage(body);
  if (typeof page === "string") return apiError(page, 400);
  const id = typeof body?.id === "string" && ID_RE.test(body.id) ? body.id : undefined;
  const r = await savePage(session.user.id, page, id);
  if (r === "full") return apiError("You share too many pages: stop sharing one you don't need.", 409);
  if (r === "not_found") return apiError("That shared page isn't there any more.", 404);
  return Response.json({ id: r.id, url: `${siteUrl()}/p/${r.id}` });
}

export async function DELETE(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID_RE.test(id)) return apiError("Bad page.", 400);
  await deletePage(session.user.id, id);
  return new Response(null, { status: 204 });
}
