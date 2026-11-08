import { guard } from "@/lib/guard";
import { anthropicSkills, hasNode, installPlugin, installSkill, installedPlugins, installedSkillIds, removePlugin } from "@/lib/plugins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What's installed from the marketplace. ?remote=anthropic lists Anthropic's public skills. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  if (url.searchParams.get("remote") === "anthropic") {
    try {
      return Response.json({ skills: await anthropicSkills() });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  return Response.json({ plugins: installedPlugins(), skills: installedSkillIds(), node: hasNode() });
}

/** {kind:"skill"|"plugin", id} installs from the catalog. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { kind?: unknown; id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  try {
    if (body?.kind === "skill") return Response.json({ skill: installSkill(id) });
    if (body?.kind === "plugin") return Response.json(installPlugin(id));
    return Response.json({ error: "Send {kind, id}." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** ?plugin=<id> removes a team (its bots and group). */
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("plugin");
  if (!id) return Response.json({ error: "Which plugin?" }, { status: 400 });
  removePlugin(id);
  return new Response(null, { status: 204 });
}
