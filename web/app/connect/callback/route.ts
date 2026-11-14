// Where connected services (Notion, Linear, Canva…) send the browser after the user approves oovi.
// Their permission page shows this address (oovi's own site) instead of "localhost". The app on the
// user's computer started the sign-in and put its local port at the end of `state`; this page passes
// the answer on to it. Nothing is stored or read here: the code can only be exchanged by the app,
// which holds the PKCE verifier.

export const dynamic = "force-dynamic";

const STATE = /^[a-f0-9]{32}\.(\d{2,5})$/;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const m = STATE.exec(q.get("state") ?? "");
  const port = m ? Number(m[1]) : 0;
  if (!m || port < 1024 || port > 65535) {
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>oovi</title></head><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0"><p>This sign-in link isn't for this page. Go back to oovi and press Connect again.</p></body></html>`,
      { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
  }
  const out = new URL(`http://127.0.0.1:${port}/api/mcp/oauth/callback`);
  for (const k of ["code", "state", "error", "error_description"]) {
    const v = q.get(k);
    if (v) out.searchParams.set(k, v);
  }
  return new Response(null, { status: 302, headers: { location: out.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
