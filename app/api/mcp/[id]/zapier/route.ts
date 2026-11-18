// The user's apps in Zapier (lib/zapier.ts): GET what's ready; POST {op: "connect", app} the link to connect
// one app; POST {op: "provision"} turns on every app already connected in Zapier.
import { guard } from "@/lib/guard";
import { getServer } from "@/lib/mcp";
import { zapierConnectLink, zapierProvision, zapierStatus } from "@/lib/zapier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown) => Response.json({ error: (e as Error).message || "Zapier didn't answer." }, { status: 502 });

export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const id = (await params).id;
  if (!getServer(id)) return Response.json({ error: "Connector not found." }, { status: 404 });
  return zapierStatus(id).then((s) => Response.json(s), fail);
}

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const id = (await params).id;
  if (!getServer(id)) return Response.json({ error: "Connector not found." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { op?: unknown; app?: unknown } | null;
  try {
    if (b?.op === "provision") return Response.json(await zapierProvision(id));
    if (b?.op === "connect") {
      const app = String(b.app ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!app) return Response.json({ error: "Choose an app." }, { status: 400 });
      const r = await zapierConnectLink(id, app);
      return "error" in r ? Response.json(r, { status: 502 }) : Response.json(r);
    }
  } catch (e) {
    return fail(e);
  }
  return Response.json({ error: "op must be connect or provision." }, { status: 400 });
}
