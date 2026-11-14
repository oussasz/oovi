// YouTube search results as a list of videos with their watch links, read from the page's own data
// (ytInitialData), so a bot can open the right video directly. Opening a watch link starts the video by
// itself: no click needed, which matters when the user's browser can't be clicked (it runs as administrator,
// or the screen is locked). Pure: tests/unit/youtube.test.mts.

export type YtVideo = { id: string; title: string; channel: string; length: string; views: string; url: string };

/** A YouTube search page: youtube.com/results?search_query=… (also m. and music. hosts). */
export function isYoutubeSearch(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/i.test(u.hostname) && u.pathname === "/results" && !!(u.searchParams.get("search_query") || u.searchParams.get("q"));
  } catch {
    return false;
  }
}

/** The JSON object assigned to `ytInitialData` in the page, or null. */
function initialData(html: string): unknown {
  const m = /(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  // Walk to the matching brace (strings may hold braces).
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const text = (v: unknown): string => {
  if (!v || typeof v !== "object") return "";
  const o = v as { simpleText?: string; runs?: { text?: string }[] };
  return o.simpleText ?? (o.runs ?? []).map((r) => r.text ?? "").join("");
};

/** The videos of a search page, in the page's order (ads, shorts shelves and channels left out). */
export function youtubeVideos(html: string, max = 10): YtVideo[] {
  const data = initialData(html);
  const out: YtVideo[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (out.length >= max || depth > 40 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    const r = o.videoRenderer as Record<string, unknown> | undefined;
    if (r && typeof r.videoId === "string" && /^[\w-]{11}$/.test(r.videoId) && !seen.has(r.videoId)) {
      seen.add(r.videoId);
      out.push({
        id: r.videoId,
        title: text(r.title).slice(0, 200),
        channel: text(r.ownerText ?? r.longBylineText).slice(0, 100),
        length: text(r.lengthText),
        views: text(r.viewCountText ?? r.shortViewCountText),
        url: `https://www.youtube.com/watch?v=${r.videoId}`,
      });
      return;
    }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(data, 0);
  return out;
}

export function youtubeList(query: string, videos: YtVideo[]): string {
  return [
    `YouTube results for "${query}" (from the page's own data):`,
    ...videos.map((v, i) => `${i + 1}. ${v.title}${v.channel ? ` — ${v.channel}` : ""}${v.length ? ` (${v.length})` : ""}${v.views ? `, ${v.views}` : ""}\n   ${v.url}`),
    "",
    "To play one for the user, open its watch link (open_in_user_browser, or open_url): the video starts by itself, no click needed. Pick the one whose title and channel match what the user asked.",
  ].join("\n");
}
