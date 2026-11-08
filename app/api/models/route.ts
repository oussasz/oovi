import { guard } from "@/lib/guard";
import { listModels } from "@/lib/models";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { ModelInfo } from "@/lib/models";

/** Live model list for a provider, with prices, so people pick real models instead of guessing names. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const p = url.searchParams.get("provider") as ProviderId | null;
  if (!p || !(p in PROVIDERS)) return Response.json({ error: "Unknown provider." }, { status: 400 });
  try {
    return Response.json({ models: await listModels(p, loadSettings(), url.searchParams.get("fresh") === "1") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
