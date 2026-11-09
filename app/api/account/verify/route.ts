import { CloudError, cloud } from "@/lib/account";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Asks the oovi account service to send the email confirmation link again.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const r = await cloud<{ alreadyVerified?: boolean } | undefined>("/api/v1/auth/send-verification", { method: "POST", auth: true, body: {} });
    return Response.json({ ok: true, alreadyVerified: !!r?.alreadyVerified });
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status: status === 0 ? 503 : status });
  }
}
