// find_places for the desktop app: the businesses and places of one area, from Overture Maps' open
// "places" data. The app sends the area (already located on the map) and the question; this route
// reads only the blocks of the data that cover that area, next to where the data is stored, and sends
// back only the answer. Reading the data from the user's own connection timed out on slow lines.
// The same reading and filtering code runs in the app when this route can't answer
// (lib/places-data.ts and lib/places-core.ts in the app; identical copies here).
import { apiError, getRequestSession, json, rateLimit, readJson } from "@/lib/api";
import { filterPlaces, sizeKm, type Box } from "@/lib/places-core";
import { placesIn } from "@/lib/places-data";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com";
const MAX_KM = 150;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in to look for places.", 401);
  if (!rateLimit(`places:${session.user.id}`, 30)) return apiError("Too many requests. Wait a moment.", 429);
  const body = await readJson(req, 16 * 1024);
  if (!body) return apiError("Invalid request.", 400);
  const b = (body.box ?? {}) as Record<string, unknown>;
  const box: Box = { xmin: num(b.xmin), xmax: num(b.xmax), ymin: num(b.ymin), ymax: num(b.ymax) };
  if (![box.xmin, box.xmax, box.ymin, box.ymax].every(Number.isFinite) || box.xmin > box.xmax || box.ymin > box.ymax || Math.abs(box.ymin) > 90 || Math.abs(box.ymax) > 90 || Math.abs(box.xmin) > 180 || Math.abs(box.xmax) > 180) {
    return apiError("Invalid area.", 400);
  }
  const { w, h } = sizeKm(box);
  if (w > MAX_KM || h > MAX_KM) return apiError("The area is too large.", 400);
  const words = (Array.isArray(body.words) ? body.words : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 12);
  const name = typeof body.name === "string" ? body.name.slice(0, 80) : "";
  const limit = Math.min(2000, Math.max(1, Math.floor(Number(body.limit)) || 100));
  try {
    const got = await placesIn(box, { bucket: BUCKET, userAgent: "oovi-server (+https://oovi.conuron.com)", signal: AbortSignal.timeout(110_000) });
    const a = filterPlaces(got.places, { words, name, withPhone: body.withPhone === true, limit });
    // Only the fields the app uses.
    const hits = a.hits.map((p) => ({ names: { primary: p.names?.primary ?? "" }, basic_category: p.basic_category, taxonomy: p.taxonomy, phones: p.phones, emails: p.emails, websites: p.websites, socials: p.socials, addresses: p.addresses, confidence: p.confidence, operating_status: p.operating_status }));
    return json({ release: got.release, skipped: got.skipped, hits, matching: a.matching, open: a.open, top: a.top });
  } catch (e) {
    console.error("places:", (e as Error).message);
    return apiError("The open places data couldn't be read right now.", 503);
  }
}
