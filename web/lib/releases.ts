export const DOWNLOAD_TARGETS = ["mac-arm64", "mac-intel", "windows"] as const;
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

export function isDownloadTarget(v: string): v is DownloadTarget {
  return (DOWNLOAD_TARGETS as readonly string[]).includes(v);
}

type ReleaseAsset = { id: number; name: string; size: number };
type Release = { tag_name: string; assets: ReleaseAsset[] };

const CACHE_MS = 5 * 60 * 1000;
let cached: { release: Release; at: number; repo: string } | null = null;

function repo() {
  return process.env.GITHUB_REPO || "oussasz/oovi";
}

function ghHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "oovi-website",
  };
}

async function latestRelease(token: string): Promise<Release> {
  const r = repo();
  if (cached && cached.repo === r && Date.now() - cached.at < CACHE_MS) return cached.release;
  const res = await fetch(`https://api.github.com/repos/${r}/releases/latest`, {
    headers: ghHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub releases lookup failed: ${res.status}`);
  const release = (await res.json()) as Release;
  cached = { release, at: Date.now(), repo: r };
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

/** Resolves a short-lived signed download URL for the latest installer, or null. */
export async function resolveDownloadUrl(target: DownloadTarget): Promise<string | null> {
  const token = process.env.GITHUB_RELEASES_TOKEN;
  if (!token) return null;
  try {
    const release = await latestRelease(token);
    const asset = matchAsset(target, release.assets ?? []);
    if (!asset) return null;
    const res = await fetch(`https://api.github.com/repos/${repo()}/releases/assets/${asset.id}`, {
      headers: ghHeaders(token, "application/octet-stream"),
      redirect: "manual",
      cache: "no-store",
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) return location;
    return null;
  } catch (err) {
    console.error("download resolve failed", err);
    return null;
  }
}
