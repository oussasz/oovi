// The account's connectors kept in the cloud (settings and sign-ins): ids and versions only.
import { listVault } from "@/lib/cloud";
import { guarded, ok, signedIn, syncOff } from "@/lib/cloud-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const who = await signedIn(req, "read");
  if (!("userId" in who)) return who;
  return guarded("vault.list", async () => {
    const r = await listVault(who.userId);
    return "off" in r ? syncOff() : ok({ items: r });
  });
}
