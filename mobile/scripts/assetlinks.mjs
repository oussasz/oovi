// web/public/.well-known/assetlinks.json for Android App Links: lets https://oovi.conuron.com/m/... open the app.
// Usage: node mobile/scripts/assetlinks.mjs <SHA-256 fingerprint of the signing certificate> [more fingerprints...]
// (the release workflow runs it when it creates the signing key). Prints the JSON.
import { pathToFileURL } from "node:url";

export const PACKAGE = "app.oovi.mobile";

/** "AB:CD:..." (32 bytes, as keytool prints it) -> the normalized form; throws on anything else. */
export function normalizeFingerprint(fp) {
  const hex = String(fp ?? "").trim().replace(/:/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error(`"${fp}" is not a SHA-256 certificate fingerprint`);
  return hex.match(/../g).join(":");
}

export function assetLinks(fingerprints) {
  const list = [...new Set(fingerprints.map(normalizeFingerprint))];
  if (!list.length) throw new Error("no fingerprint given");
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: PACKAGE, sha256_cert_fingerprints: list },
    },
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(assetLinks(process.argv.slice(2)), null, 2));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
