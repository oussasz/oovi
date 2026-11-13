import { NextResponse } from "next/server";
import { auth } from "./auth";
import { pool } from "./db";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  createdAt: string;
};

type UserLike = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  createdAt: Date | string;
};

export function toPublicUser(u: UserLike): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image ?? null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

/** Parses a JSON object body. Returns null on invalid JSON / non-object / too large. */
export async function readJson(req: Request, maxBytes = 512 * 1024): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Headers for calling auth.api without forwarding unrelated request headers. */
export function authHeaders(req: Request, opts: { withAuthorization?: boolean } = {}): Headers {
  const h = new Headers();
  for (const name of ["user-agent", "x-forwarded-for", "x-real-ip", "x-vercel-ip-country", "x-oovi-version", "x-oovi-platform"]) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  if (opts.withAuthorization) {
    const a = req.headers.get("authorization");
    if (a) h.set("authorization", a);
    const c = req.headers.get("cookie");
    if (c) h.set("cookie", c);
  }
  return h;
}

/** Resolves the session from a Bearer token (desktop) or the session cookie (web). */
export async function getRequestSession(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: authHeaders(req, { withAuthorization: true }) });
    return session ?? null;
  } catch {
    return null;
  }
}

export async function loadPublicUser(id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query(
    'SELECT id, email, name, image, "createdAt" FROM "user" WHERE id = $1',
    [id],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Small fixed-window in-memory rate limiter (per serverless instance). */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

type BetterAuthErrorLike = {
  statusCode?: unknown;
  body?: { message?: string; code?: string };
  message?: string;
};

export function describeAuthError(err: unknown): { status: number; message: string; code?: string } {
  const e = err as BetterAuthErrorLike;
  const status = typeof e?.statusCode === "number" ? e.statusCode : 500;
  const message = e?.body?.message || e?.message || "Something went wrong.";
  return { status, message, code: e?.body?.code };
}
