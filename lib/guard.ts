// Every API route calls this first. The app holds your API keys and drives a
// browser, so it must only answer requests from this machine's own pages:
// - Host check blocks DNS-rebinding (evil.com resolving to 127.0.0.1).
// - Origin check blocks other websites POSTing to localhost (CSRF).

const LOCAL = ["localhost", "127.0.0.1", "::1"];

function allowedHosts(): string[] {
  const extra = (process.env.OOVI_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...LOCAL, ...extra];
}

const hostnameOf = (host: string) => host.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

export function guard(req: Request): Response | null {
  const host = req.headers.get("host") ?? "";
  if (!allowedHosts().includes(hostnameOf(host))) return new Response("Forbidden host", { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host.toLowerCase() === host.toLowerCase();
    } catch {
      ok = false;
    }
    if (!ok) return new Response("Forbidden origin", { status: 403 });
  }
  return null;
}

export const isSessionId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{8,64}$/.test(v);
