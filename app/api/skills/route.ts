import { guard } from "@/lib/guard";
import { importSkill, listSkills, saveSkill } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(listSkills());
}

/** {url} installs a SKILL.md from a link; {name, description, body} creates one. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { url?: unknown; name?: unknown; description?: unknown; body?: unknown } | null;
  try {
    const skill =
      typeof body?.url === "string"
        ? await importSkill(body.url)
        : saveSkill({ name: String(body?.name ?? ""), description: String(body?.description ?? ""), body: String(body?.body ?? ""), source: "you" });
    return Response.json(skill, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
