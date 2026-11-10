export const DOWNLOAD_TARGETS = ["mac-arm64", "mac-intel", "windows"] as const;

/**
 * oovi's Microsoft Store page (e.g. https://apps.microsoft.com/detail/9N...). When set, "Download for
 * Windows" opens the Store: no SmartScreen warning (Microsoft signs Store apps) and the Store keeps
 * oovi updated. The .exe installer stays available at /download/windows?installer=1.
 */
export const microsoftStoreUrl = (): string | null => {
  const v = process.env.NEXT_PUBLIC_MICROSOFT_STORE_URL?.trim();
  return v && /^https:\/\/(apps\.microsoft\.com|www\.microsoft\.com)\//.test(v) ? v : null;
};
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

export function isDownloadTarget(v: string): v is DownloadTarget {
  return (DOWNLOAD_TARGETS as readonly string[]).includes(v);
}

type ReleaseAsset = { id: number; name: string; size: number; browser_download_url: string; download_count?: number };
export type Release = { tag_name: string; name?: string | null; body?: string | null; published_at?: string | null; draft?: boolean; prerelease?: boolean; assets: ReleaseAsset[] };

// Where installers and release notes come from. Nothing on the site or in the app links to GitHub:
// downloads and updates go through oovi.conuron.com (/download, /updates), notes are shown at /changelog.
// - With GITHUB_RELEASES_TOKEN (fine-grained, Contents: read-only), the PRIVATE repo is read and the
//   files are handed out through short-lived signed links.
// - Without it, the public downloads repo is used (it was the only source up to 0.8.8).
const PUBLIC_REPO = () => process.env.PUBLIC_RELEASES_REPO || "oussasz/oovi-downloads";
const PRIVATE_REPO = () => process.env.GITHUB_REPO || "oussasz/oovi";
type Source = { repo: string; token?: string };
function sources(): Source[] {
  const token = process.env.GITHUB_RELEASES_TOKEN?.trim();
  return token ? [{ repo: PRIVATE_REPO(), token }, { repo: PUBLIC_REPO() }] : [{ repo: PUBLIC_REPO() }];
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { release: Release; at: number }>();
const listCache = new Map<string, { releases: Release[]; at: number }>();

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

/** Published releases (newest first) from the first source that answers. */
export async function listReleases(): Promise<Release[]> {
  for (const src of sources()) {
    const hit = listCache.get(src.repo);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.releases;
    try {
      const res = await fetch(`https://api.github.com/repos/${src.repo}/releases?per_page=50`, { headers: ghHeaders(src.token), cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const releases = ((await res.json()) as Release[]).filter((r) => !r.draft && !r.prerelease);
      listCache.set(src.repo, { releases, at: Date.now() });
      return releases;
    } catch (err) {
      console.error(`release list from ${src.repo} failed`, err);
    }
  }
  return [];
}

/** A short-lived direct link to a release file, without the repository's name in it when possible. */
async function assetLink(src: Source, asset: ReleaseAsset): Promise<string | null> {
  if (!src.token) return asset.browser_download_url || null;
  const res = await fetch(`https://api.github.com/repos/${src.repo}/releases/assets/${asset.id}`, {
    headers: ghHeaders(src.token, "application/octet-stream"),
    redirect: "manual",
    cache: "no-store",
  });
  const location = res.headers.get("location");
  return res.status >= 300 && res.status < 400 && location ? location : null;
}

/** Update files the app asks for (electron-updater's generic provider): only these names. */
export const UPDATE_FILE = /^(latest(-mac)?\.yml|oovi-Setup-\d+\.\d+\.\d+\.exe(\.blockmap)?|oovi-\d+\.\d+\.\d+(-arm64|-x64)?\.(dmg|zip)(\.blockmap)?)$/;

/**
 * Find an update file. latest*.yml always comes from the newest release; a versioned file comes
 * from its own release (the updater also asks for the OLD version's .blockmap to download only
 * what changed).
 */
async function findUpdateAsset(name: string): Promise<{ src: Source; asset: ReleaseAsset } | null> {
  const version = name.match(/(\d+\.\d+\.\d+)/)?.[1];
  for (const src of sources()) {
    try {
      let release: Release | null = null;
      if (version) {
        const res = await fetch(`https://api.github.com/repos/${src.repo}/releases/tags/v${version}`, { headers: ghHeaders(src.token), cache: "no-store" });
        if (res.ok) release = (await res.json()) as Release;
      } else release = await latestRelease(src.repo, src.token);
      const asset = release?.assets?.find((a) => a.name === name);
      if (asset) return { src, asset };
    } catch (err) {
      console.error(`update lookup in ${src.repo} failed`, err);
    }
  }
  return null;
}

/** The contents of latest.yml / latest-mac.yml (small text files), or null. */
export async function updateManifest(name: "latest.yml" | "latest-mac.yml"): Promise<string | null> {
  const found = await findUpdateAsset(name);
  if (!found) return null;
  const url = await assetLink(found.src, found.asset);
  if (!url) return null;
  const res = await fetch(url, { headers: { "User-Agent": "oovi-website" }, cache: "no-store" });
  return res.ok ? await res.text() : null;
}

/** A direct link to a versioned update file, or null. */
export async function updateFileUrl(name: string): Promise<string | null> {
  const found = await findUpdateAsset(name);
  return found ? assetLink(found.src, found.asset) : null;
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
    const res = await fetch(`https://api.github.com/repos/${PUBLIC_REPO()}/releases?per_page=100`, { headers: ghHeaders(process.env.GITHUB_RELEASES_TOKEN?.trim()), cache: "no-store" });
    if (!res.ok) throw new Error(`GitHub releases list failed: ${res.status}`);
    const releases = (await res.json()) as Release[];
    const data: GithubDownloads = { total: 0, byTarget: emptyTargets(), byVersion: [] };
    for (const r of releases) {
      const v = { tag: r.tag_name, publishedAt: r.published_at ?? null, total: 0, byTarget: emptyTargets() };
      for (const t of DOWNLOAD_TARGETS) {
        const a = matchAsset(t, r.assets ?? []);
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
  for (const src of sources()) {
    try {
      const asset = matchAsset(target, (await latestRelease(src.repo, src.token)).assets ?? []);
      const url = asset ? await assetLink(src, asset) : null;
      if (url) return url;
    } catch (err) {
      console.error(`download lookup in ${src.repo} failed`, err);
    }
  }
  return null;
}
