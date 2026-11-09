import { guard } from "@/lib/guard";
import { hostedStatus } from "@/lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// theOovi credits and today's limit for the signed-in person ({signedIn:false} when signed out).
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const status = await hostedStatus(fresh);
  return Response.json(status ?? { signedIn: false }, { headers: { "cache-control": "no-store" } });
}
