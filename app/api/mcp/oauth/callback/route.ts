import { guard } from "@/lib/guard";
import { getServer, oauthStore, resetConnection, testServer } from "@/lib/mcp";
import { finishSignIn } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

function page(title: string, text: string, ok: boolean): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · oovi</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fbfaf7;color:#171717}
@media (prefers-color-scheme:dark){body{background:#131312;color:#f2f2ee}.card{background:#1e1e1c!important;border-color:#2d2c29!important}}
.card{max-width:440px;margin:16px;padding:32px;border-radius:24px;background:#fff;border:1px solid #e9e6de;text-align:center}
.icon{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;margin:0 auto 12px;font-size:28px;color:#fff;background:${ok ? "#2f9e62" : "#d9534f"}}
h1{font-size:22px;margin:0 0 8px}p{margin:0;opacity:.75}</style></head>
<body><div class="card"><div class="icon">${ok ? "✓" : "!"}</div><h1>${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** The service sends the browser back here after you approve (or decline) the connection. */
export async function GET(req: Request) {
  // Opened by the user's normal browser (no launch cookie there): the OAuth state protects it.
  const denied = guard(req, { token: false });
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const error = q.get("error");
  if (error) return page("Not connected", q.get("error_description") || "You declined, or the service stopped the sign-in. You can try again from oovi.", false);
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state) return page("Not connected", "This page is missing the sign-in code. Press Connect again in oovi.", false);
  try {
    const id = await finishSignIn(state, code, (serverId) => {
      const s = getServer(serverId);
      return s?.url ? { url: s.url, store: oauthStore(serverId) } : null;
    });
    await resetConnection(id);
    const name = getServer(id)?.name ?? "the service";
    const t = await testServer(id);
    if (!t.ok) return page(`Signed in to ${name}`, `But oovi couldn't load its tools yet: ${t.error ?? "unknown error"}. Press Test in oovi.`, false);
    return page(`Connected to ${name}`, `${t.tools?.length ?? 0} tools are ready. You can close this tab and go back to oovi.`, true);
  } catch (e) {
    return page("Not connected", (e as Error).message, false);
  }
}
