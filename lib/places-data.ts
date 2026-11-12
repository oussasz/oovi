// Reading Overture Maps' open "places" files for one area: find the newest release on the public
// bucket, keep an index of which blocks of rows cover which part of the world, and read only the
// blocks that cover the area asked. Used by the app (lib/places.ts, when the oovi server can't answer)
// and by the oovi server (web/lib/places-data.ts is an identical copy: tests/unit/places-sync.test.mts).
// Every download has its own time limit, so a slow connection gets slow answers, not failures.

import { parquetMetadataAsync, parquetRead, type AsyncBuffer } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { inside, overlaps, type Box, type Place } from "./places-core";

export type Block = [start: number, rows: number, xmin: number, xmax: number, ymin: number, ymax: number];
export type PlacesIndex = { release: string; files: { key: string; size: number; blocks: Block[] }[] };
export type DataOptions = {
  bucket: string;
  userAgent: string;
  signal?: AbortSignal;
  /** Where the index is kept between runs (a file in the app, memory on the server). */
  cache?: { load(release: string, files: number): PlacesIndex | null; save(index: PlacesIndex): void };
  /** Blocks read for one question at most (each is 5 to 10 MB). */
  maxBlocks?: number;
};

const COLUMNS = ["names", "basic_category", "taxonomy", "phones", "emails", "websites", "socials", "addresses", "confidence", "operating_status", "bbox"];
const PER_REQUEST_MS = 90_000;

const limit = (signal: AbortSignal | undefined, ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

async function getText(url: string, o: DataOptions): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": o.userAgent }, signal: limit(o.signal, 30_000) });
  if (!res.ok) throw new Error(`the open places data answered ${res.status}`);
  return res.text();
}

/** A remote file read in ranges, each range with its own time limit. */
function remote(url: string, size: number, o: DataOptions): AsyncBuffer {
  return {
    byteLength: size,
    async slice(start: number, end?: number) {
      const last = (end ?? size) - 1;
      const res = await fetch(url, { headers: { "user-agent": o.userAgent, range: `bytes=${start}-${last}` }, signal: limit(o.signal, PER_REQUEST_MS) });
      if (!res.ok) throw new Error(`the open places data answered ${res.status}`);
      return await res.arrayBuffer();
    },
  };
}

/** The newest release's place files, from the bucket's own listing. */
async function listRelease(o: DataOptions): Promise<{ release: string; files: { key: string; size: number }[] }> {
  const top = await getText(`${o.bucket}/?list-type=2&prefix=release/&delimiter=/`, o);
  const releases = [...top.matchAll(/<Prefix>release\/([^<\/]+)\/<\/Prefix>/g)].map((m) => m[1]!).sort();
  // The newest first; the one before it as a spare (a release is listed a little before all its files are there).
  for (const release of releases.reverse().slice(0, 2)) {
    const xml = await getText(`${o.bucket}/?list-type=2&prefix=${encodeURIComponent(`release/${release}/theme=places/type=place/`)}`, o);
    const files = [...xml.matchAll(/<Contents>[\s\S]*?<Key>([^<]+\.parquet)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)].map((m) => ({ key: m[1]!, size: Number(m[2]) }));
    if (files.length) return { release, files };
  }
  throw new Error("no place files in the data release");
}

async function buildIndex(o: DataOptions): Promise<PlacesIndex> {
  const { release, files } = await listRelease(o);
  const kept = o.cache?.load(release, files.length);
  if (kept) return kept;
  const out: PlacesIndex["files"] = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++]!;
      const md = await parquetMetadataAsync(remote(`${o.bucket}/${f.key}`, f.size, o));
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
  const index: PlacesIndex = { release, files: out.sort((a, b) => a.key.localeCompare(b.key)) };
  o.cache?.save(index);
  return index;
}

const memo: { at: number; index: PlacesIndex | null; building: Promise<PlacesIndex> | null } = { at: 0, index: null, building: null };

/** The index, checked against the bucket at most once a day (one build at a time, shared by callers). */
export async function placesIndex(o: DataOptions): Promise<PlacesIndex> {
  if (memo.index && Date.now() - memo.at < 24 * 3600_000) return memo.index;
  memo.building ??= buildIndex(o).finally(() => (memo.building = null));
  const index = await memo.building;
  memo.index = index;
  memo.at = Date.now();
  return index;
}

/** Every place inside the area (not filtered). skipped: blocks of a very large area left unread. */
export async function placesIn(box: Box, o: DataOptions): Promise<{ places: Place[]; release: string; skipped: number }> {
  const index = await placesIndex(o);
  const wanted: { key: string; size: number; block: Block }[] = [];
  for (const f of index.files) for (const b of f.blocks) if (overlaps(box, { xmin: b[2], xmax: b[3], ymin: b[4], ymax: b[5] })) wanted.push({ key: f.key, size: f.size, block: b });
  const read = wanted.slice(0, o.maxBlocks ?? 12);
  const places: Place[] = [];
  const files = new Map<string, Promise<{ file: AsyncBuffer; md: Awaited<ReturnType<typeof parquetMetadataAsync>> }>>();
  const open = (key: string, size: number) => {
    let m = files.get(key);
    if (!m) {
      m = (async () => {
        const file = remote(`${o.bucket}/${key}`, size, o);
        return { file, md: await parquetMetadataAsync(file) };
      })();
      files.set(key, m);
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
