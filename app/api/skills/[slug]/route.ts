import { guard } from "@/lib/guard";
import { deleteSkill, getSkill, saveSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { slug } = await params;
  const existing = getSkill(slug);
  if (!existing) return Response.json({ error: "Skill not found." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { name?: unknown; description?: unknown; body?: unknown } | null;
  try {
    return Response.json(saveSkill({ slug: existing.slug, name: String(body?.name ?? existing.name), description: String(body?.description ?? existing.description), body: String(body?.body ?? existing.body) }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  deleteSkill((await params).slug);
  return new Response(null, { status: 204 });
}
