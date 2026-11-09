import { guard } from "@/lib/guard";
import { LIMITS, isMemoryTarget, readRaw, updatedAt, writeRaw } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = () => ({
  user: readRaw("user"),
  memory: readRaw("memory"),
  knowledge: readRaw("knowledge"),
  limits: LIMITS,
  updated: { user: updatedAt("user"), memory: updatedAt("memory"), knowledge: updatedAt("knowledge") },
});

/** The memory files: USER.md, MEMORY.md and the user's KNOWLEDGE.md. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(view());
}

/** {target: "user" | "memory" | "knowledge", text} replaces a file (entries separated by a line with §). */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { target?: unknown; text?: unknown };
  if (!isMemoryTarget(b.target) || typeof b.text !== "string") return Response.json({ error: "Send {target, text}." }, { status: 400 });
  if (b.text.length > LIMITS[b.target] + 200) return Response.json({ error: `Too long: the limit is ${LIMITS[b.target]} characters.` }, { status: 400 });
  // Knowledge goes into every prompt: never keep secrets there.
  if (b.target === "knowledge" && /(api[_ -]?key|password|passwd|secret[_ -]?key)\s*[:=]/i.test(b.text)) return Response.json({ error: "Knowledge can't hold passwords or keys." }, { status: 400 });
  writeRaw(b.target, b.text);
  return Response.json(view());
}
