import { guard } from "@/lib/guard";
import { publicSettings, updateSettings, type SettingsPatch } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// API keys are write-only: GET never returns them, only "…abcd" hints.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(publicSettings());
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  let patch: SettingsPatch;
  try {
    patch = (await req.json()) as SettingsPatch;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  updateSettings(patch);
  return Response.json(publicSettings());
}
