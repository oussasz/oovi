// App versions ("0.10.7"): which ones the console asks to update (Admin > theOovi > Minimum app version, and the
// "Ask to update" email). Pure: tests/unit/versions.test.mts.

/** -1, 0 or 1 for two versions like "0.10.7" ("-beta" parts are ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  return 0;
}

/** True when this app version is below the minimum (unknown versions, like "dev", are never blocked). */
export const tooOld = (version: string | null, cfg: { minAppVersion: string }): boolean =>
  !!cfg.minAppVersion && !!version && /^\d/.test(version) && compareVersions(version, cfg.minAppVersion) < 0;
