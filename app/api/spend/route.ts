// What the bots spent today and this month (lib/spend.ts), for Settings > Spending limits.
import { guard } from "@/lib/guard";
import { readLedger } from "@/lib/spend";
import { totals } from "@/lib/spend-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(totals(readLedger(), new Date()));
}
