import { guard } from "@/lib/guard";
import { syncSetup } from "@/lib/setup-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Syncs the setup with the account now (lib/setup-sync.ts): {ok, restored, error?}. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await syncSetup());
}
