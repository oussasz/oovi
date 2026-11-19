import { CloudError, cloud } from "@/lib/account";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A single-use link to a website page for this account (the website has no sign-in any more): "Join the pilot".
// The account answers {url} (web/app/api/v1/app-links); the app opens it in the browser.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  let purpose: unknown;
  try {
    purpose = ((await req.json()) as { purpose?: unknown }).purpose;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (purpose !== "pilot") return Response.json({ error: "Unknown purpose." }, { status: 400 });
  try {
    const r = await cloud<{ url: string }>("/api/v1/app-links", { method: "POST", auth: true, body: { purpose } });
    if (!/^https:\/\//.test(r.url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(r.url)) return Response.json({ error: "Bad link." }, { status: 502 });
    return Response.json({ url: r.url });
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status: status === 0 ? 503 : status });
  }
}
