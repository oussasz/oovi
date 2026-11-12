// find_places: businesses and places in an area, from Overture Maps' open "places" data
// (https://overturemaps.org: Meta, Microsoft, Foursquare and others; CDLA-Permissive-2.0). Free, no key.
// The data is a set of large Parquet files on a public bucket, sorted by location. Nothing is
// downloaded whole: the app reads each file's index once per data release (which part of the world
// each block of rows covers), then for a question fetches only the blocks that cover the area asked.
// The area's outline comes from OpenStreetMap's geocoder (Nominatim), with Photon as a second source.

import fs from "node:fs";
import path from "node:path";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { appVersion } from "./account";
import type { ToolSpec } from "./llm";
import { rowLine, type ListRow } from "./page-list-core";
import { atLeast, categoryWords, inCategory, inside, isOpen, nameHas, overlaps, placeRow, sizeKm, topCategories, type Box, type Place } from "./places-core";
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
/** Blocks of rows read for one question (each is 5 to 10 MB to download). */
const MAX_BLOCKS = 12;
const COLUMNS = ["names", "basic_category", "taxonomy", "phones", "emails", "websites", "socials", "addresses", "confidence", "operating_status", "bbox"];

type Block = [start: number, rows: number, xmin: number, xmax: number, ymin: number, ymax: number];
type Index = { release: string; files: { key: string; size: number; blocks: Block[] }[] };

const withTimeout = (signal: AbortSignal | undefined, ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function getText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA(), ...headers }, signal: withTimeout(signal, 30_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

// ---------- the data release and its index ----------

const cacheDir = () => path.join(dataDir(), "cache", "places");
let memo: { at: number; index: Index } | null = null;
let building: Promise<Index> | null = null;

/** The newest release's place files, from the bucket's own listing. */
async function listRelease(signal?: AbortSignal): Promise<{ release: string; files: { key: string; size: number }[] }> {
  const top = await getText(`${BUCKET()}/?list-type=2&prefix=release/&delimiter=/`, signal);
  const releases = [...top.matchAll(/<Prefix>release\/([^<\/]+)\/<\/Prefix>/g)].map((m) => m[1]!).sort();
  // The newest first; the one before it as a spare (a release is listed a little before all its files are there).
  for (const release of releases.reverse().slice(0, 2)) {
    const xml = await getText(`${BUCKET()}/?list-type=2&prefix=${encodeURIComponent(`release/${release}/theme=places/type=place/`)}`, signal);
    const files = [...xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+\.parquet)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)].map((m) => ({ key: m[1]!, size: Number(m[2]) }));
    if (files.length) return { release, files };
  }
  throw new Error("no place files in the data release");
}

const fileOf = (key: string, size: number, signal?: AbortSignal) => asyncBufferFromUrl({ url: `${BUCKET()}/${key}`, byteLength: size, requestInit: { headers: { "user-agent": UA() }, signal: withTimeout(signal, 120_000) } });

async function buildIndex(signal?: AbortSignal): Promise<Index> {
  const { release, files } = await listRelease(signal);
  const saved = path.join(cacheDir(), `${release}.json`);
  try {
    const j = JSON.parse(fs.readFileSync(saved, "utf8")) as Index;
    if (j.release === release && j.files.length === files.length) return j;
  } catch {
    /* not built yet for this release */
  }
  const out: Index["files"] = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]!;
      const md = await parquetMetadataAsync(await fileOf(f.key, f.size, signal));
      const blocks: Block[] = [];
      let start = 0;
      for (const rg of md.row_groups) {
        const rows = Number(rg.num_rows);
        const stat = (name: string) => rg.columns.find((c) => c.meta_data?.path_in_schema.join(".") === name)?.meta_data?.statistics;
        const [x0, x1, y0, y1] = [stat("bbox.xmin")?.min_value, stat("bbox.xmax")?.max_value, stat("bbox.ymin")?.min_value, stat("bbox.ymax")?.max_value].map(Number);
        // A block without location statistics could hold anything: it is read for every question.
        blocks.push([start, rows, ...([x0, x1, y0, y1].every(Number.isFinite) ? [x0!, x1!, y0!, y1!] : [-180, 180, -90, 90])] as Block);
        start += rows;
      }
      out.push({ key: f.key, size: f.size, blocks });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const index: Index = { release, files: out.sort((a, b) => a.key.localeCompare(b.key)) };
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    for (const old of fs.readdirSync(cacheDir())) if (old.endsWith(".json") && old !== `${release}.json`) fs.rmSync(path.join(cacheDir(), old), { force: true });
    fs.writeFileSync(`${saved}.tmp`, JSON.stringify(index));
    fs.renameSync(`${saved}.tmp`, saved);
  } catch {
    /* no cache: it is rebuilt next time */
  }
  return index;
}

/** The index, checked against the bucket at most once a day (one build at a time, shared by callers). */
async function getIndex(signal?: AbortSignal): Promise<Index> {
  if (memo && Date.now() - memo.at < 24 * 3600_000) return memo.index;
  building ??= buildIndex(signal).finally(() => (building = null));
  const index = await building;
  memo = { at: Date.now(), index };
  return index;
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

// ---------- the question ----------

async function placesIn(box: Box, signal?: AbortSignal): Promise<{ places: Place[]; release: string; skipped: number }> {
  const index = await getIndex(signal);
  const wanted: { key: string; size: number; block: Block }[] = [];
  for (const f of index.files) for (const b of f.blocks) if (overlaps(box, { xmin: b[2], xmax: b[3], ymin: b[4], ymax: b[5] })) wanted.push({ key: f.key, size: f.size, block: b });
  const read = wanted.slice(0, MAX_BLOCKS);
  const places: Place[] = [];
  const meta = new Map<string, Promise<{ file: Awaited<ReturnType<typeof fileOf>>; md: Awaited<ReturnType<typeof parquetMetadataAsync>> }>>();
  const open = (key: string, size: number) => {
    let m = meta.get(key);
    if (!m) {
      m = (async () => {
        const file = await fileOf(key, size, signal);
        return { file, md: await parquetMetadataAsync(file) };
      })();
      meta.set(key, m);
    }
    return m;
  };
  let next = 0;
  const worker = async () => {
    while (next < read.length) {
      const w = read[next++]!;
      const { file, md } = await open(w.key, w.size);
      await parquetRead({
        file,
        metadata: md,
        compressors,
        columns: COLUMNS,
        rowStart: w.block[0],
        rowEnd: w.block[0] + w.block[1],
        rowFormat: "object",
        onComplete: (rows) => {
          for (const r of rows as Place[]) if (inside(r.bbox, box)) places.push(r);
        },
      });
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return { places, release: index.release, skipped: wanted.length - read.length };
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
    const got = await placesIn(area.box, ctx.signal);
    const open = got.places.filter(isOpen);
    let hits = open.filter((p) => inCategory(p, words) && (!name || nameHas(p, name)));
    if (i.with_phone === true) hits = hits.filter((p) => p.phones?.some(Boolean));
    const where = `${area.label} (about ${w < 10 ? w.toFixed(1) : Math.round(w)} × ${h < 10 ? h.toFixed(1) : Math.round(h)} km)`;
    if (!hits.length) {
      if (!open.length) return fail(`The open map data has no places in ${where}. Try the city instead of the district, or use scrape_list / research on a local directory.`);
      return fail(
        `Nothing in ${where} matches ${[words.length ? `the categories ${words.join(", ")}` : "", name ? `the name "${name}"` : "", i.with_phone === true ? "with a phone number" : ""].filter(Boolean).join(" and ") || "that"}. The data has ${open.length} places there, in these categories (most common first): ${topCategories(open).join(", ")}. Call again with categories from this list.`,
      );
    }
    hits.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const source = `Overture Maps open data (${got.release})`;
    const rows = hits.slice(0, limit).map((p) => placeRow(p, source)).filter((r): r is ListRow => !!r);
    const withPhone = rows.filter((r) => r.phone).length;
    const head = [
      `${hits.length} places in ${where}${words.length ? ` in the categories ${words.join(", ")}` : ""}${name ? ` named "${name}"` : ""}; ${rows.length < hits.length ? `the ${rows.length} best-known are given (raise \`limit\` for more); ` : ""}${withPhone} of ${rows.length} have a phone number.`,
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
