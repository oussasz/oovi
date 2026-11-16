// Announcements from the oovi team (web/lib/announcements.ts), for components/Announcements.tsx:
// GET → {items}; POST {id, kind: "shown" | "opened" | "closed"}. Signed out or offline: nothing.
import { cloud, sessionToken } from "@/lib/account";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { id: string; title: string; barText: string; html: string; window: boolean; bar: boolean; seen: boolean };

export async function GET(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  if (!sessionToken()) return Response.json({ items: [] });
  try {
    const r = await cloud<{ items?: Item[] } | undefined>("/api/v1/announcements", { auth: true });
    const items = (Array.isArray(r?.items) ? r.items : [])
      .filter((x) => x && /^\d{1,18}$/.test(String(x.id)) && typeof x.html === "string")
      .slice(0, 3)
      .map((x) => ({ id: String(x.id), title: String(x.title ?? "").slice(0, 140), barText: String(x.barText ?? "").slice(0, 160), html: x.html.slice(0, 200_000), window: x.window === true, bar: x.bar === true, seen: x.seen === true }));
    return Response.json({ items });
  } catch {
    return Response.json({ items: [] });
  }
}

export async function POST(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { id?: unknown; kind?: unknown } | null;
  const id = String(b?.id ?? "");
  const kind = b?.kind === "shown" || b?.kind === "opened" || b?.kind === "closed" ? b.kind : null;
  if (!/^\d{1,18}$/.test(id) || !kind || !sessionToken()) return new Response(null, { status: 204 });
  await cloud(`/api/v1/announcements/${id}`, { method: "POST", auth: true, body: { kind } }).catch(() => {});
  return new Response(null, { status: 204 });
}
