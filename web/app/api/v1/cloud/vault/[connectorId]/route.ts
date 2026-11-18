// One connector's settings and sign-in (never AI keys), versioned like chats. DELETE when it is removed.
import { deleteVault } from "@/lib/cloud";
import { isId } from "@/lib/cloud-core";
import { vaultGet, vaultPut } from "@/lib/cloud-handlers";
import { fail, guarded, notFound, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ connectorId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  const { connectorId } = await params;
  return guarded("vault.get", () => vaultGet(who.userId, connectorId));
}

export async function PUT(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "write");
  if (!("userId" in who)) return who;
  const { connectorId } = await params;
  return guarded("vault.put", () => vaultPut(req, who.userId, connectorId));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const who = await signedIn(req, "write");
  if (!("userId" in who)) return who;
  const { connectorId } = await params;
  if (!isId(connectorId)) return fail(400, "bad_request", "Invalid connector id.");
  return guarded("vault.delete", async () => {
    const r = await deleteVault(who.userId, connectorId);
    if (r !== true && r !== false) return syncOff();
    return r ? ok({ ok: true }) : notFound("This connector");
  });
}
