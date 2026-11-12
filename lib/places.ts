// find_places: businesses and places in an area, from Overture Maps' open "places" data
// (https://overturemaps.org: Meta, Microsoft, Foursquare and others; CDLA-Permissive-2.0). Free, no key.
// The oovi server answers the question (it reads the data next to where it is stored); when it can't,
// the app reads the data itself (lib/places-data.ts). The area's outline comes from OpenStreetMap's
// geocoder (Nominatim), with Photon as a second source, asked from this computer.

import fs from "node:fs";
import path from "node:path";
import { appVersion, cloudUrl, sessionToken } from "./account";
import type { ToolSpec } from "./llm";
import { rowLine, type ListRow } from "./page-list-core";
import { atLeast, categoryWords, filterPlaces, placeRow, sizeKm, type Box, type Place, type PlaceAnswer, type PlaceQuery } from "./places-core";
import { placesIn, type PlacesIndex } from "./places-data";
import { dataDir } from "./settings";
import type { ToolCall, ToolResult } from "./types";

export const PLACES_SPEC: ToolSpec = {
  name: "find_places",
  description:
    "Find businesses and places in an area in ONE call, from open map data (Overture Maps), without visiting any website: name, category, address, phone number, email, website or social page. Use it FIRST for any list of local businesses (cafés, restaurants, salons, clinics, shops, hotels, schools, agencies…) in a city, district or neighbourhood, anywhere in the world; then use scrape_list or research only for what is still missing. Give `table` to put the rows straight into a work table. The data comes from business pages and can be out of date: keep the Source column, and write \"to confirm\" in a Status column for numbers nobody has checked.",
  parameters: {
    type: "object",
    properties: {
      area: { type: "string", description: "The place to look in, as a person would write it: 'Hydra, Alger', 'Bab Ezzouar, Algérie', 'Lyon 3e', 'Sidi Yahia, Alger'. A district or a city, not a whole country. Or 'latitude,longitude' for around a point." },
      categories: { type: "array", items: { type: "string" }, description: "What kind of place, in English words: ['cafe','coffee shop'], ['beauty salon','hair','spa'], ['dental','clinic'], ['restaurant']. Leave out for every kind." },
      name: { type: "string", description: "Only places whose name contains these words (optional)." },
      with_phone: { type: "boolean", description: "true: only places that have a phone number." },
      limit: { type: "integer", minimum: 1, maximum: 2000, description: "At most this many places, best-known first (default 100)." },
      table: { type: "string", description: "Work table to add the places to (created if new; known names and phone numbers are completed, not repeated). Without it the places are only shown to you." },
    },
    required: ["area"],
  },
};

// Tests point these at a local server (the same way OOVI_TELEGRAM_API does for Telegram).
const BUCKET = () => (process.env.OOVI_PLACES_URL || "https://overturemaps-us-west-2.s3.amazonaws.com").replace(/\/$/, "");
const GEOCODER = () => (process.env.OOVI_GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const GEOCODER_2 = () => (process.env.OOVI_GEOCODER2_URL || "https://photon.komoot.io").replace(/\/$/, "");
const UA = () => `oovi/${appVersion()} (+https://oovi.conuron.com)`;

/** An area this wide or tall (km) is a region or a country: too many places to be a useful answer. */
const MAX_KM = 150;

const withTimeout = (signal: AbortSignal | undefined, ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function getText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA(), ...headers }, signal: withTimeout(signal, 30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

/** The index of the open data, kept on disk once per data release (rebuilt only when a new one comes out). */
const cacheDir = () => path.join(dataDir(), "cache", "places");
const diskCache = {
  load(release: string, files: number): PlacesIndex | null {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(cacheDir(), `${release}.json`), "utf8")) as PlacesIndex;
      return j.release === release && j.files.length === files ? j : null;
    } catch {
      return null;
    }
  },
  save(index: PlacesIndex) {
    try {
      fs.mkdirSync(cacheDir(), { recursive: true });
      for (const old of fs.readdirSync(cacheDir())) if (old.endsWith(".json") && old !== `${index.release}.json`) fs.rmSync(path.join(cacheDir(), old), { force: true });
      const f = path.join(cacheDir(), `${index.release}.json`);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(index));
      fs.renameSync(`${f}.tmp`, f);
    } catch {
      /* no cache: it is rebuilt next time */
    }
  },
};

/**
 * The places that answer the question. First through the oovi server, which reads the data next to
 * where it is stored and sends back only the answer (a few KB): on a slow connection, reading the data
 * here took longer than any time limit. When the server can't answer (signed out, offline, an older
 * server), the data is read from here, each download with its own time limit.
 */
async function answer(box: Box, q: PlaceQuery, signal?: AbortSignal): Promise<{ a: PlaceAnswer; release: string; skipped: number; via: "server" | "direct" }> {
  const token = sessionToken();
  if (token && !process.env.OOVI_PLACES_DIRECT) {
    try {
      const res = await fetch(`${cloudUrl()}/api/v1/places`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-oovi-version": appVersion() },
        body: JSON.stringify({ box, ...q }),
        signal: withTimeout(signal, 120_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { release?: string; skipped?: number; hits?: Place[]; matching?: number; open?: number; top?: string[] };
        if (Array.isArray(j.hits) && typeof j.release === "string") return { a: { hits: j.hits, matching: Number(j.matching) || 0, open: Number(j.open) || 0, top: Array.isArray(j.top) ? j.top.map(String) : [] }, release: j.release, skipped: Number(j.skipped) || 0, via: "server" };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  const got = await placesIn(box, { bucket: BUCKET(), userAgent: UA(), signal, cache: diskCache });
  return { a: filterPlaces(got.places, q), release: got.release, skipped: got.skipped, via: "direct" };
}

// ---------- the area ----------

export type Area = { box: Box; label: string };
const areas = new Map<string, Area>();
let lastGeocode = 0;

/** "Hydra, Alger" -> its outline. Tries OpenStreetMap's geocoder, then Photon. */
export async function findArea(text: string, signal?: AbortSignal): Promise<Area | null> {
  const q = text.replace(/\s+/g, " ").trim().slice(0, 200);
  const point = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (point) {
    const [lat, lon] = [Number(point[1]), Number(point[2])];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { box: atLeast({ xmin: lon, xmax: lon, ymin: lat, ymax: lat }), label: `around ${lat}, ${lon}` };
  }
  const known = areas.get(q.toLowerCase());
  if (known) return known;
  let found: Area | null = null;
  try {
    // The public geocoder asks for at most one request a second.
    const wait = lastGeocode + 1_100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeocode = Date.now();
    const list = JSON.parse(await getText(`${GEOCODER()}/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, signal, { "accept-language": "fr,en,ar" })) as { boundingbox?: string[]; display_name?: string; category?: string }[];
    // A district or a town before a shop or a post office with the same name.
    const hit = [...list].sort((a, b) => Number(/boundary|place/.test(b.category ?? "")) - Number(/boundary|place/.test(a.category ?? "")))[0];
    const bb = hit?.boundingbox?.map(Number);
    if (hit && bb?.length === 4 && bb.every(Number.isFinite)) found = { box: atLeast({ ymin: bb[0]!, ymax: bb[1]!, xmin: bb[2]!, xmax: bb[3]! }), label: hit.display_name ?? q };
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  if (!found) {
    try {
      const j = JSON.parse(await getText(`${GEOCODER_2()}/api/?limit=5&q=${encodeURIComponent(q)}`, signal)) as { features?: { properties?: { extent?: number[]; name?: string; city?: string; country?: string; osm_key?: string }; geometry?: { coordinates?: number[] } }[] };
      const hit = [...(j.features ?? [])].sort((a, b) => Number(!!b.properties?.extent) - Number(!!a.properties?.extent))[0];
      const ex = hit?.properties?.extent;
      const pt = hit?.geometry?.coordinates;
      const label = [hit?.properties?.name, hit?.properties?.city, hit?.properties?.country].filter(Boolean).join(", ") || q;
      if (ex?.length === 4 && ex.every(Number.isFinite)) found = { box: atLeast({ xmin: ex[0]!, ymax: ex[1]!, xmax: ex[2]!, ymin: ex[3]! }), label };
      else if (pt?.length === 2 && pt.every(Number.isFinite)) found = { box: atLeast({ xmin: pt[0]!, xmax: pt[0]!, ymin: pt[1]!, ymax: pt[1]! }), label };
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  if (found) areas.set(q.toLowerCase(), found);
  return found;
}

export type PlacesCtx = { signal?: AbortSignal; addToTable?: (table: string, rows: ListRow[], source: string) => { text: string; isError?: boolean } };

export async function runPlacesTool(call: ToolCall, ctx: PlacesCtx = {}): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const i = call.input;
  const areaText = typeof i.area === "string" ? i.area.trim() : "";
  if (!areaText) return fail("area is required: the city or district to look in, e.g. 'Hydra, Alger'.");
  const words = categoryWords(i.categories);
  const name = typeof i.name === "string" ? i.name.trim().slice(0, 80) : "";
  const limit = Math.min(2000, Math.max(1, Math.floor(Number(i.limit) || 100)));
  const table = typeof i.table === "string" ? i.table.trim() : "";
  if (table && !ctx.addToTable) return fail("Work tables aren't available here. Call find_places without `table` and add the rows with work_table.");
  try {
    const area = await findArea(areaText, ctx.signal);
    if (!area) return fail(`"${areaText}" wasn't found on the map. Write it as a person would in an address, with the city and the country ("Hydra, Alger, Algérie"), or try a nearby district or the city itself.`);
    const { w, h } = sizeKm(area.box);
    if (w > MAX_KM || h > MAX_KM) return fail(`"${area.label}" is about ${Math.round(w)} × ${Math.round(h)} km: too large for one question. Ask for a city or a district, one call each.`);
    const got = await answer(area.box, { words, name, withPhone: i.with_phone === true, limit }, ctx.signal);
    const hits = got.a.hits;
    const where = `${area.label} (about ${w < 10 ? w.toFixed(1) : Math.round(w)} × ${h < 10 ? h.toFixed(1) : Math.round(h)} km)`;
    if (!hits.length) {
      if (!got.a.open) return fail(`The open map data has no places in ${where}. Try the city instead of the district, or use scrape_list / research on a local directory.`);
      return fail(
        `Nothing in ${where} matches ${[words.length ? `the categories ${words.join(", ")}` : "", name ? `the name "${name}"` : "", i.with_phone === true ? "with a phone number" : ""].filter(Boolean).join(" and ") || "that"}. The data has ${got.a.open} places there, in these categories (most common first): ${got.a.top.join(", ")}. Call again with categories from this list.`,
      );
    }
    const source = `Overture Maps open data (${got.release})`;
    const rows = hits.map((p) => placeRow(p, source)).filter((r): r is ListRow => !!r);
    const withPhone = rows.filter((r) => r.phone).length;
    const head = [
      `${got.a.matching} places in ${where}${words.length ? ` in the categories ${words.join(", ")}` : ""}${name ? ` named "${name}"` : ""}; ${rows.length < got.a.matching ? `the ${rows.length} best-known are given (raise \`limit\` for more); ` : ""}${withPhone} of ${rows.length} have a phone number.`,
      `Source: ${source}. It is built from business pages (mostly Facebook pages in some countries): a place can be missing, closed or have an old number. Treat numbers as "to confirm".`,
      got.skipped ? `The area is large: only part of it was read. Ask district by district for a complete answer.` : "",
    ];
    if (table) {
      const saved = ctx.addToTable!(table, rows, source);
      if (saved.isError) return fail(saved.text);
      return { id: call.id, name: call.name, content: [...head, saved.text, "The first ones:", ...rows.slice(0, 5).map((r, n) => rowLine(r, n + 1)), rows.length > 5 ? `… and ${rows.length - 5} more, all in the table.` : ""].filter(Boolean).join("\n") };
    }
    const lines: string[] = [];
    let used = 0;
    for (const [n, r] of rows.entries()) {
      const l = rowLine(r, n + 1);
      if (used + l.length > 14_000) break;
      used += l.length;
      lines.push(l);
    }
    return { id: call.id, name: call.name, content: [...head, ...lines, rows.length > lines.length ? `… ${rows.length - lines.length} more not shown: call again with \`table\` to keep them all.` : ""].filter(Boolean).join("\n") };
  } catch (e) {
    if (ctx.signal?.aborted) return fail("Stopped by the user.");
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);
    return fail(`The open places data couldn't be read right now (${msg}). This is a network or service problem, not proof that there are no places: try again in a moment, or use scrape_list / research on a local directory meanwhile. Don't save this as a lesson.`);
  }
}
