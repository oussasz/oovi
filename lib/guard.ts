// Every API route calls this first. The app holds your API keys and drives a
// browser, so it must only answer requests from this machine's own pages:
// - Host check blocks DNS-rebinding (evil.com resolving to 127.0.0.1).
// - Origin check blocks other websites POSTing to localhost (CSRF).
// - In the desktop app, a per-launch secret (electron/main.cjs sets it as an HttpOnly cookie in
//   oovi's own window) is required too: other programs on this computer, and web pages or a
//   bot's browser pointed at 127.0.0.1, can't call the API. Without it (`npm run web`, dev) the
//   checks above are all there is.

import crypto from "node:crypto";
import { currentSession } from "./account";

export const TOKEN_COOKIE = "oovi_t";

const LOCAL = ["localhost", "127.0.0.1", "::1"];

function allowedHosts(): string[] {
  const extra = (process.env.OOVI_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...LOCAL, ...extra];
}

const hostnameOf = (host: string) => host.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

/**
 * opts.account (default true): the route also needs a signed-in oovi account.
 * Account routes themselves pass { account: false }.
 * opts.token (default true): the launch secret is required (only the OAuth callback, which the
 * user's normal browser opens, goes without; it's protected by its OAuth state instead).
 */
export function guard(req: Request, opts: { account?: boolean; token?: boolean } = {}): Response | null {
  const denied = localOnly(req);
  if (denied) return denied;
  if (opts.token !== false && !tokenOk(req, localToken())) return new Response("Forbidden", { status: 403 });
  if (opts.account !== false && !currentSession()) return Response.json({ error: "Sign in to oovi first." }, { status: 401 });
  return null;
}

function localOnly(req: Request): Response | null {
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

/** The desktop app's launch secret (set by electron/main.cjs; not in the environment, so child processes never see it). */
const localToken = (): string | undefined => (globalThis as typeof globalThis & { __ooviDesktop?: { localToken?: string } }).__ooviDesktop?.localToken || undefined;

/** The request carries the launch secret as its cookie (always true when no secret is set). */
export function tokenOk(req: Request, token: string | undefined): boolean {
  if (!token) return true;
  const raw = req.headers.get("cookie") ?? "";
  let got = "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === TOKEN_COOKIE) got = part.slice(i + 1).trim();
  }
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
