// Shared plumbing of the /api/v1/cloud routes: who is asking (a signed-in account, or the runner), rate limits,
// reading bodies with a size cap, and errors that never carry content.
import { NextResponse } from "next/server";
import { getRequestSession, rateLimit } from "./api";
import { isBlocked } from "./credits";
import { logCode, parseDeviceHeader, runnerAuth, sameOrigin } from "./cloud-core";
import { siteUrl } from "./site";
import { touchDevice } from "./cloud";
import { DEVICE_HEADER, RUNNER_HEADER, type CloudError } from "./cloud-types";

const NO_STORE = { "cache-control": "no-store" };

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function fail(status: number, code: CloudError["code"], error: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, code, ...extra }, { status, headers: NO_STORE });
}

export const syncOff = () => fail(403, "sync_off", "Cloud sync is off for this account. Turn it on in oovi's Settings > Sync.");
export const notFound = (what = "This chat") => fail(404, "not_found", `${what} isn't in the cloud.`);

/**
 * Rate limits per account (per server instance, like /api/v1/setup). "read" covers lists, gets and long-polls;
 * "claim" the desktop's every-3-seconds claim.
 */
const LIMITS = { read: [900, 10 * 60_000], write: [400, 10 * 60_000], job: [120, 10 * 60_000], claim: [500, 10 * 60_000], status: [60, 10 * 60_000] } as const;
export type Bucket = keyof typeof LIMITS;

/** The signed-in account (id from the session only), or the answer to send instead. Marks the device seen. */
export async function signedIn(req: Request, bucket: Bucket): Promise<{ userId: string } | NextResponse> {
  const hosts = [new URL(req.url).host, new URL(siteUrl()).host];
  if (!sameOrigin(req.method, req.headers.get("origin"), hosts)) return fail(403, "forbidden", "Not allowed from another website.");
  const session = await getRequestSession(req);
  if (!session) return fail(401, "signed_out", "Sign in first.");
  const userId = session.user.id;
  const [limit, windowMs] = LIMITS[bucket];
  if (!rateLimit(`cloud:${bucket}:${userId}`, limit, windowMs)) return fail(429, "busy", "Too many requests. Try again in a few minutes.");
  if (await isBlocked(userId)) return fail(403, "blocked", "This account has been blocked. Contact contact@conuron.com.");
  const device = parseDeviceHeader(req.headers.get(DEVICE_HEADER));
  if (device) await touchDevice(userId, device.kind, device.deviceId).catch(() => {});
  return { userId };
}

/**
 * The runner-only API: header x-oovi-runner must equal RUNNER_SECRET (constant time). No RUNNER_SECRET = the
 * runner API answers 404, as if it didn't exist. A user session never opens it.
 */
export function runnerOnly(req: Request): NextResponse | null {
  const r = runnerAuth(req.headers.get(RUNNER_HEADER), process.env.RUNNER_SECRET);
  if (r === "off") return fail(404, "runner_off", "Not found.");
  if (r === "denied") return fail(401, "forbidden", "Not allowed.");
  if (!rateLimit("cloud:runner", 6000, 60_000)) return fail(429, "busy", "Too many requests.");
  return null;
}

/** A JSON object body, at most maxBytes; "too_big" or "bad" otherwise. */
export async function body(req: Request, maxBytes: number): Promise<Record<string, unknown> | "too_big" | "bad"> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return "too_big";
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) return "too_big";
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : "bad";
  } catch {
    return "bad";
  }
}

/** Runs a handler; a failure answers 503 and logs only a code (never the error text, it could quote data). */
export async function guarded(where: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    console.error(`cloud ${where} failed:`, logCode(err));
    return fail(503, "unavailable", "The cloud isn't available right now. Try again in a minute.");
  }
}
