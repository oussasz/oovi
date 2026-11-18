// Share a Canvas page by a public link: GET lists this chat's shared pages, POST {kind, name} shares or updates
// one, DELETE {kind, name} stops sharing it (lib/shares.ts).
import { guard } from "@/lib/guard";
import { sharePage, sharesOf, unsharePage } from "@/lib/shares";
import { getChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function target(req: Request, params: Ctx["params"]) {
  const chat = getChat((await params).id);
  if (!chat) return { error: Response.json({ error: "Chat not found." }, { status: 404 }) };
  const b = (await req.json().catch(() => null)) as { kind?: unknown; name?: unknown } | null;
  if ((b?.kind !== "note" && b?.kind !== "table") || typeof b.name !== "string" || !b.name) return { error: Response.json({ error: "Choose a page or a table." }, { status: 400 }) };
  return { chat, kind: b.kind as "note" | "table", name: b.name };
}

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const chat = getChat((await params).id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  return Response.json({ shares: sharesOf(chat.id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const t = await target(req, params);
  if ("error" in t) return t.error;
  const r = await sharePage(t.chat.id, t.kind, t.name);
  return typeof r === "string" ? Response.json({ error: r }, { status: 400 }) : Response.json({ share: r });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const t = await target(req, params);
  if ("error" in t) return t.error;
  const err = await unsharePage(t.chat.id, t.kind, t.name);
  return err ? Response.json({ error: err }, { status: 502 }) : Response.json({ ok: true });
}
