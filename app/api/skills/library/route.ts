import { guard } from "@/lib/guard";
import { librarySkill, searchLibrary } from "@/lib/skills-library";
import { listSkills, saveSkill, slugify } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["work", "writing", "research", "coding", "life"]);

/** ?q=&category=&offset= : a page of the library, and which of its skills the user already has (by name). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const u = new URL(req.url).searchParams;
  const category = u.get("category");
  const r = searchLibrary((u.get("q") ?? "").slice(0, 100), category && CATEGORIES.has(category) ? category : null, Math.max(0, Number(u.get("offset")) || 0), 30);
  const have = new Set(listSkills().map((s) => slugify(s.name)));
  return Response.json({ ...r, installed: r.items.filter((s) => have.has(slugify(s.name))).map((s) => s.id) });
}

/** {id}: add a library skill to the user's skills. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const s = typeof body?.id === "string" ? librarySkill(body.id) : undefined;
  if (!s) return Response.json({ error: "Unknown skill." }, { status: 404 });
  const skill = saveSkill({ name: s.name, description: s.description, body: s.body, source: `library:${s.source.repo}` });
  return Response.json(skill);
}
