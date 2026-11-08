import { guard } from "@/lib/guard";
import { removeServer, testServer, updateServer } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Connect now and list the server's tools. */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await testServer((await params).id));
}

/** {enabled?, trusted?} */
export async function PUT(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown; trusted?: unknown } | null;
  await updateServer((await params).id, {
    enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    trusted: typeof body?.trusted === "boolean" ? body.trusted : undefined,
  });
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  await removeServer((await params).id);
  return new Response(null, { status: 204 });
}
