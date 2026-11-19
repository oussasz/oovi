// Android version from a release tag: "v0.13.0" -> versionName "0.13.0", versionCode 13000
// (major * 1,000,000 + minor * 1,000 + patch). Each release must have a higher code than the last, and Google Play
// allows at most 2,100,000,000. Usage in the workflow: node mobile/scripts/version.mjs v0.13.0
// prints "name=0.13.0" and "code=13000" (one per line, for $GITHUB_OUTPUT).

import { pathToFileURL } from "node:url";

/** @returns {{ name: string, code: number }} */
export function androidVersion(tag) {
  const m = /^v?(\d{1,4})\.(\d{1,3})\.(\d{1,3})$/.exec(String(tag ?? "").trim());
  if (!m) throw new Error(`"${tag}" is not a version tag like v0.13.0`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (minor > 999 || patch > 999) throw new Error(`"${tag}": minor and patch must be at most 999`);
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (code < 1 || code > 2_100_000_000) throw new Error(`"${tag}" gives versionCode ${code}, outside 1..2100000000`);
  return { name: `${major}.${minor}.${patch}`, code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const v = androidVersion(process.argv[2]);
    console.log(`name=${v.name}`);
    console.log(`code=${v.code}`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
