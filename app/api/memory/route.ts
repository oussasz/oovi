import { guard } from "@/lib/guard";
import { LIMITS, readRaw, writeRaw } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The two memory files (USER.md and MEMORY.md). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ user: readRaw("user"), memory: readRaw("memory"), limits: LIMITS });
}

/** {target: "user" | "memory", text} replaces a file (entries separated by a line with §). */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { target?: unknown; text?: unknown };
  if ((b.target !== "user" && b.target !== "memory") || typeof b.text !== "string") return Response.json({ error: "Send {target, text}." }, { status: 400 });
  if (b.text.length > LIMITS[b.target] + 200) return Response.json({ error: `Too long: the limit is ${LIMITS[b.target]} characters.` }, { status: 400 });
  writeRaw(b.target, b.text);
  return Response.json({ user: readRaw("user"), memory: readRaw("memory"), limits: LIMITS });
}
