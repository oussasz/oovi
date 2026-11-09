import { guard } from "@/lib/guard";
import { getServer, oauthStore, resetConnection, testServer } from "@/lib/mcp";
import { startSignIn } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Start "Connect" for a sign-in connector. Returns {authUrl} to open in the browser, or the test result if already signed in. */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const id = (await params).id;
  const s = getServer(id);
  if (!s || s.transport !== "http" || s.auth !== "oauth" || !s.url) return Response.json({ error: "That connector doesn't use sign-in." }, { status: 400 });
  try {
    const r = await startSignIn(id, s.url, oauthStore(id), new URL(req.url).origin);
    if (r.authUrl) return Response.json({ authUrl: r.authUrl });
    await resetConnection(id);
    return Response.json(await testServer(id));
  } catch (e) {
    return Response.json({ error: `Couldn't start signing in to ${s.name}: ${(e as Error).message}` }, { status: 502 });
  }
}
