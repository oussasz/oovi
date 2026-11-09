export const DOWNLOAD_TARGETS = ["mac-arm64", "mac-intel", "windows"] as const;
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

export function isDownloadTarget(v: string): v is DownloadTarget {
  return (DOWNLOAD_TARGETS as readonly string[]).includes(v);
}

type ReleaseAsset = { id: number; name: string; size: number; browser_download_url: string };
type Release = { tag_name: string; assets: ReleaseAsset[] };

// Installers are published to a PUBLIC repo that holds only the installer files
// (the app's source code stays in the private repo). Public release assets can
// be downloaded by anyone, so no token is needed. If GITHUB_RELEASES_TOKEN is
// set, the private repo is used as a fallback.
const PUBLIC_REPO = () => process.env.PUBLIC_RELEASES_REPO || "oussasz/oovi-downloads";
const PRIVATE_REPO = () => process.env.GITHUB_REPO || "oussasz/oovi";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { release: Release; at: number }>();

function ghHeaders(token?: string, accept = "application/vnd.github+json"): Record<string, string> {
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "oovi-website",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function latestRelease(repo: string, token?: string): Promise<Release> {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.release;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: ghHeaders(token), cache: "no-store" });
  if (!res.ok) throw new Error(`GitHub releases lookup for ${repo} failed: ${res.status}`);
  const release = (await res.json()) as Release;
  cache.set(repo, { release, at: Date.now() });
  return release;
}

function matchAsset(target: DownloadTarget, assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const find = (re: RegExp) => assets.find((a) => re.test(a.name));
  switch (target) {
    case "mac-arm64":
      return find(/^oovi-[\d.]+-arm64\.dmg$/i);
    case "mac-intel":
      return find(/^oovi-[\d.]+\.dmg$/i) ?? find(/^oovi-[\d.]+-x64\.dmg$/i);
    case "windows":
      return find(/^oovi-Setup-[\d.]+\.exe$/i);
  }
}

export type GithubDownloads = {
  total: number;
  byTarget: Record<DownloadTarget, number>;
  byVersion: { tag: string; publishedAt: string | null; total: number; byTarget: Record<DownloadTarget, number> }[];
};
let countsCache: { at: number; data: GithubDownloads } | null = null;

const emptyTargets = (): Record<DownloadTarget, number> => ({ "mac-arm64": 0, "mac-intel": 0, windows: 0 });

/**
 * Installer download counts as GitHub counts them, for every release of the
 * public downloads repo. Includes downloads from before the site's own counting
 * started, and direct links. Null if GitHub can't be reached.
 */
export async function githubDownloadCounts(): Promise<GithubDownloads | null> {
  if (countsCache && Date.now() - countsCache.at < 10 * 60 * 1000) return countsCache.data;
  try {
    const res = await fetch(`https://api.github.com/repos/${PUBLIC_REPO()}/releases?per_page=100`, { headers: ghHeaders(), cache: "no-store" });
    if (!res.ok) throw new Error(`GitHub releases list failed: ${res.status}`);
    const releases = (await res.json()) as (Release & { published_at?: string | null; assets: (ReleaseAsset & { download_count?: number })[] })[];
    const data: GithubDownloads = { total: 0, byTarget: emptyTargets(), byVersion: [] };
    for (const r of releases) {
      const v = { tag: r.tag_name, publishedAt: r.published_at ?? null, total: 0, byTarget: emptyTargets() };
      for (const t of DOWNLOAD_TARGETS) {
        const a = matchAsset(t, r.assets ?? []) as (ReleaseAsset & { download_count?: number }) | undefined;
        const n = a?.download_count ?? 0;
        v.byTarget[t] += n;
        v.total += n;
      }
      for (const t of DOWNLOAD_TARGETS) data.byTarget[t] += v.byTarget[t];
      data.total += v.total;
      data.byVersion.push(v);
    }
    countsCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("github download counts failed", err);
    return countsCache?.data ?? null;
  }
}

/** URL of the latest installer for this platform, or null if none is available. */
export async function resolveDownloadUrl(target: DownloadTarget): Promise<string | null> {
  // 1. Public downloads repo: a plain, permanent download link.
  try {
    const asset = matchAsset(target, (await latestRelease(PUBLIC_REPO())).assets ?? []);
    if (asset?.browser_download_url) return asset.browser_download_url;
  } catch (err) {
    console.error("public download lookup failed", err);
  }

  // 2. Optional fallback: the private repo, with a read-only token.
  const token = process.env.GITHUB_RELEASES_TOKEN;
  if (!token) return null;
  try {
    const asset = matchAsset(target, (await latestRelease(PRIVATE_REPO(), token)).assets ?? []);
    if (!asset) return null;
    const res = await fetch(`https://api.github.com/repos/${PRIVATE_REPO()}/releases/assets/${asset.id}`, {
      headers: ghHeaders(token, "application/octet-stream"),
      redirect: "manual",
      cache: "no-store",
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) return location;
    return null;
  } catch (err) {
    console.error("private download lookup failed", err);
    return null;
  }
}
