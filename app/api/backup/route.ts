import { exportBundle, importBundle } from "@/lib/backup";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download a backup of this account's bots, chats, skills, memory and settings (no API keys). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const bundle = exportBundle();
  return new Response(JSON.stringify(bundle, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="oovi-backup-${bundle.exportedAt.slice(0, 10)}.json"`,
    },
  });
}

/** Restore from a backup file (JSON body). */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return Response.json(importBundle(await req.json()));
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Couldn't read that backup." }, { status: 400 });
  }
}
