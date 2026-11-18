// Runner only: a connector's settings and sign-in for the account whose job it runs. PUT saves a refreshed
// sign-in (services that rotate their tokens need it).
import { isUserId } from "@/lib/cloud-core";
import { vaultGet, vaultPut } from "@/lib/cloud-handlers";
import { fail, guarded, runnerOnly } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ userId: string; connectorId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId, connectorId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  return guarded("runner.vault.get", () => vaultGet(userId, connectorId));
}

export async function PUT(req: Request, { params }: Ctx) {
  const denied = runnerOnly(req);
  if (denied) return denied;
  const { userId, connectorId } = await params;
  if (!isUserId(userId)) return fail(400, "bad_request", "Invalid account id.");
  return guarded("runner.vault.put", () => vaultPut(req, userId, connectorId));
}
