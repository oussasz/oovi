// The side-effect half of images for documents (pure parts: lib/card.ts, lib/media.ts):
// - render an HTML page to PNG/JPEG with the local Chrome/Edge (the same engine as PDFs),
// - load a picture the bots may use (only from the project folder or Downloads/oovi),
// - find a free photo (Openverse, then Wikimedia Commons; no key, fails soft offline),
// - optionally generate a photo with the user's own OpenAI or Gemini key.

import fs from "node:fs";
import path from "node:path";
import { checkUrl, downloadsDir, launchLocal } from "./browser";
import { creditLine, commonsUrl, stripDownloadsPrefix, openverseUrl, parseCommons, parseOpenverse, photoQuery, sniffImage, validImage, type ImageInfo, type Orientation, type PhotoCandidate } from "./media";
import { loadSettings, type BrowserConfig } from "./settings";
import type { Workspace } from "./types";
import { resolveInWorkspace } from "./workspace";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const UA = "oovi-desktop/1.0 (document images)";

export type Picture = { data: Buffer; info: ImageInfo; credit?: string; source?: string };

const dataUri = (p: Picture) => `data:${p.info.mime};base64,${p.data.toString("base64")}`;
export { dataUri as pictureDataUri };

// ---------- rendering ----------

/** Screenshot a self-contained page at exactly width x height. No network: everything is inline. */
export async function renderHtml(html: string, width: number, height: number, browser: BrowserConfig, type: "png" | "jpeg" = "png"): Promise<Buffer> {
  let b;
  try {
    b = await launchLocal(browser.channel);
  } catch (e) {
    throw new Error(`Making images needs Google Chrome or Microsoft Edge on this computer (${(e as Error).message.split("\n")[0]}).`);
  }
  try {
    const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route("**/*", (route) => (/^(data|about):/i.test(route.request().url()) ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => document.body?.getAttribute("data-ready") === "1", undefined, { timeout: 10_000 }).catch(() => {});
    return await page.screenshot({ type, clip: { x: 0, y: 0, width, height }, ...(type === "jpeg" ? { quality: 90 } : {}), timeout: 30_000 });
  } finally {
    await b.close().catch(() => {});
  }
}

// ---------- local pictures ----------

const insideDir = (dir: string, abs: string) => {
  const rel = path.relative(dir, abs);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * A file in Downloads/oovi from the path a bot gave: "Brief.docx", "Downloads/oovi/Brief.docx",
 * "oovi/Brief.docx" or an absolute path inside the folder. If that file isn't there, the same
 * name directly in the folder is tried. Returns the path to use (it may not exist yet), or null
 * when the path points outside Downloads/oovi and no file of that name is inside it.
 */
export function resolveInDownloads(p: string): string | null {
  const dir = path.resolve(downloadsDir());
  const raw = String(p ?? "").trim();
  if (!raw) return null;
  let cand: string | null = null;
  if (path.isAbsolute(raw)) {
    const abs = path.resolve(raw);
    cand = insideDir(dir, abs) ? abs : null;
  } else {
    const abs = path.resolve(dir, stripDownloadsPrefix(raw));
    cand = insideDir(dir, abs) ? abs : null;
  }
  if (cand && fs.existsSync(cand)) return cand;
  const base = path.basename(raw.replace(/\\/g, "/"));
  if (base && base !== "." && base !== "..") {
    const byName = path.join(dir, base);
    if (fs.existsSync(byName)) return byName;
  }
  return cand;
}

/** A picture from the project folder or Downloads/oovi (never anywhere else on the computer). */
export function loadLocalPicture(p: string, ws: Workspace | undefined): Picture {
  const want = String(p ?? "").trim();
  if (!want) throw new Error("No image path given.");
  let abs: string | undefined;
  if (ws) {
    try {
      abs = resolveInWorkspace(ws, want).abs;
      if (!fs.existsSync(abs)) abs = undefined;
    } catch {
      abs = undefined;
    }
  }
  if (!abs) {
    const found = resolveInDownloads(want);
    if (!found) throw new Error(`${want}: bots can only use pictures from the project folder or Downloads/oovi (attach the picture to the chat, or create it with create_image first).`);
    abs = found;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`${want} doesn't exist.`);
  const size = fs.statSync(abs).size;
  if (size > MAX_IMAGE_BYTES) throw new Error(`${want} is too big (max 12 MB).`);
  const data = fs.readFileSync(abs);
  const info = sniffImage(data);
  if (!validImage(info)) throw new Error(`${want} isn't a PNG, JPEG, GIF or WebP picture.`);
  return { data, info, source: path.basename(abs) };
}

// ---------- network ----------

async function getBytes(url: string, opts: { maxBytes: number; timeoutMs: number; accept?: string; signal?: AbortSignal }): Promise<{ data: Buffer; type: string }> {
  let current = url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    for (let hop = 0; hop < 5; hop++) {
      const bad = checkUrl(current, false);
      if (bad) throw new Error(bad);
      const res = await fetch(current, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, accept: opts.accept ?? "*/*" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect without a location from ${new URL(current).host}`);
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`${new URL(current).host} answered ${res.status}`);
      const len = Number(res.headers.get("content-length") || 0);
      if (len > opts.maxBytes) throw new Error("Too big");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Empty response");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Too big");
        }
        chunks.push(value);
      }
      return { data: Buffer.concat(chunks), type: res.headers.get("content-type") ?? "" };
    }
    throw new Error("Too many redirects");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const { data } = await getBytes(url, { maxBytes: 3 * 1024 * 1024, timeoutMs, accept: "application/json", signal });
  return JSON.parse(data.toString("utf8"));
}

export type PhotoResult = { picture?: Picture; candidate?: PhotoCandidate; error?: string };

/**
 * A free photo for this query (Openverse first, then Wikimedia Commons), with its credit line.
 * Never throws: offline or nothing found gives { error } so the design can go on without it.
 */
export async function findPhoto(query: string, orientation: Orientation = "any", opts: { allowWebp?: boolean; signal?: AbortSignal } = {}): Promise<PhotoResult> {
  const q = photoQuery(query);
  if (!q) return { error: "empty photo search" };
  const errors: string[] = [];
  const started = Date.now();
  const budget = 25_000;
  // Both libraries are asked at once (Openverse is preferred, Commons answers while it's slow).
  const settle = (p: Promise<PhotoCandidate[]>) => p.then((v) => ({ v }), (e: unknown) => ({ e: (e as Error).message || String(e) }));
  const openverse = settle(getJson(openverseUrl(q, orientation), 9_000, opts.signal).then((j) => parseOpenverse(j)));
  const commons = settle(getJson(commonsUrl(q), 9_000, opts.signal).then((j) => parseCommons(j)));
  let openverseUp = false;
  const sources: [string, () => Promise<PhotoCandidate[]>][] = [
    ["Openverse", async () => {
      const r = await openverse;
      if ("e" in r) throw new Error(r.e);
      openverseUp = true;
      return r.v;
    }],
    // The shape is a preference (any photo can be cropped), but only worth asking again if Openverse answered.
    ...(orientation !== "any"
      ? [["Openverse", async () => (openverseUp ? parseOpenverse(await getJson(openverseUrl(q, "any"), 8_000, opts.signal)) : [])] as [string, () => Promise<PhotoCandidate[]>]]
      : []),
    ["Wikimedia Commons", async () => {
      const r = await commons;
      if ("e" in r) throw new Error(r.e);
      return r.v;
    }],
  ];
  for (const [name, list] of sources) {
    if (Date.now() - started > budget) break;
    let cands: PhotoCandidate[];
    try {
      cands = await list();
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      continue;
    }
    for (const c of cands.slice(0, 6)) {
      if (Date.now() - started > budget) break;
      try {
        const { data } = await getBytes(c.url, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: 12_000, accept: "image/jpeg,image/png,image/*;q=0.8", signal: opts.signal });
        const info = sniffImage(data);
        if (!validImage(info) || (info.kind === "webp" && !opts.allowWebp) || info.kind === "gif") continue;
        return { picture: { data, info, credit: creditLine(c), source: c.landing }, candidate: c };
      } catch (e) {
        errors.push(`${new URL(c.url).host}: ${(e as Error).message}`);
      }
    }
    if (!cands.length) errors.push(`${name}: no free photo for "${q}"`);
  }
  return { error: errors.slice(0, 3).join("; ") || `no free photo for "${q}"` };
}

// ---------- optional AI photos (the user's own key) ----------

export function aiPhotoProvider(): "openai" | "gemini" | null {
  try {
    const s = loadSettings();
    if (s.providers.openai?.apiKey) return "openai";
    if (s.providers.gemini?.apiKey) return "gemini";
  } catch {
    /* no settings yet */
  }
  return null;
}

/** Generate a photo with OpenAI (gpt-image-1) or Gemini, whichever key the user added. */
export async function aiPhoto(prompt: string, shape: Orientation, signal?: AbortSignal): Promise<Picture> {
  const s = loadSettings();
  const clean = String(prompt).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 2000);
  if (!clean) throw new Error("ai_prompt is empty.");
  const timeout = AbortSignal.timeout(120_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const openai = s.providers.openai?.apiKey;
  const gemini = s.providers.gemini?.apiKey;
  let data: Buffer | undefined;
  let by = "";
  if (openai) {
    const size = shape === "wide" ? "1536x1024" : shape === "tall" ? "1024x1536" : "1024x1024";
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      signal: sig,
      headers: { authorization: `Bearer ${openai}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: clean, size, n: 1, quality: "medium" }),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(`OpenAI image: ${j.error?.message ?? res.status}`);
    data = Buffer.from(j.data[0].b64_json, "base64");
    by = "AI image (OpenAI)";
  } else if (gemini) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
      method: "POST",
      signal: sig,
      headers: { "x-goog-api-key": gemini, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${clean}\nAspect: ${shape === "wide" ? "16:9 landscape" : shape === "tall" ? "4:5 portrait" : "square"}. No text in the image.` }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
    });
    const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]; error?: { message?: string } };
    const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!res.ok || !b64) throw new Error(`Gemini image: ${j.error?.message ?? res.status}`);
    data = Buffer.from(b64, "base64");
    by = "AI image (Gemini)";
  } else {
    throw new Error("AI photos need an OpenAI or Google Gemini API key in Settings.");
  }
  const info = sniffImage(data);
  if (!validImage(info)) throw new Error("The AI provider didn't return a picture.");
  return { data, info, credit: by, source: by };
}
