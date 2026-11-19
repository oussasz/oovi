import { test } from "node:test";
import assert from "node:assert/strict";
import { isAndroidBrowser, isNativeApp } from "../../web/lib/app-detect.ts";
import { ANDROID_APK, newestAsset, type Release } from "../../web/lib/releases.ts";
import { androidVersion } from "../../mobile/scripts/version.mjs";
import { assetLinks, normalizeFingerprint } from "../../mobile/scripts/assetlinks.mjs";

const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const APP = `${CHROME_ANDROID.replace("Chrome/131.0.0.0 Mobile", "Version/4.0 Chrome/131.0.0.0 Mobile")} ooviApp/1.0`;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

test("the native app is recognised by its user agent", () => {
  assert.equal(isNativeApp(APP), true);
  assert.equal(isNativeApp(`${IPHONE} ooviApp/1.0`), true);
  assert.equal(isNativeApp(CHROME_ANDROID), false);
  assert.equal(isNativeApp("Mozilla/5.0 NotooviApp/1.0"), false);
  assert.equal(isNativeApp(""), false);
  assert.equal(isNativeApp(undefined), false);
});

test("Get the Android app shows only in Android browsers", () => {
  assert.equal(isAndroidBrowser(CHROME_ANDROID), true);
  assert.equal(isAndroidBrowser(APP), false);
  assert.equal(isAndroidBrowser(IPHONE), false);
  assert.equal(isAndroidBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});

test("version code from the release tag", () => {
  assert.deepEqual(androidVersion("v0.13.0"), { name: "0.13.0", code: 13000 });
  assert.deepEqual(androidVersion("0.14.2"), { name: "0.14.2", code: 14002 });
  assert.deepEqual(androidVersion("v1.0.0"), { name: "1.0.0", code: 1_000_000 });
  // Every later version gets a higher code (phones refuse to install a lower one over a higher one).
  const order = ["v0.9.9", "v0.13.0", "v0.13.1", "v0.14.0", "v1.0.0", "v1.2.10"].map((t) => androidVersion(t).code);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const bad of ["", "v0.13", "v0.13.0-beta", "latest", "v0.1000.0", "v0.0.0"]) assert.throws(() => androidVersion(bad), bad);
});

test("assetlinks.json for App Links", () => {
  const fp = "ab:".repeat(31) + "ab";
  assert.equal(normalizeFingerprint(fp.replace(/:/g, "")), fp.toUpperCase());
  const json = assetLinks([fp, fp.toUpperCase()]);
  assert.equal(json.length, 1);
  assert.equal(json[0]!.target.package_name, "app.oovi.mobile");
  assert.deepEqual(json[0]!.target.sha256_cert_fingerprints, [fp.toUpperCase()]);
  assert.deepEqual(json[0]!.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.throws(() => normalizeFingerprint("SHA1:AB:CD"));
  assert.throws(() => assetLinks([]));
});

test("the website finds the APK, also in an older release", () => {
  assert.ok(ANDROID_APK.test("oovi-0.14.0.apk"));
  assert.ok(!ANDROID_APK.test("oovi-0.14.0.aab"));
  assert.ok(!ANDROID_APK.test("app-release.apk"));
  assert.ok(!ANDROID_APK.test("oovi-0.14.0-test.3.apk"));
  const rel = (tag: string, names: string[], extra: Partial<Release> = {}): Release => ({
    tag_name: tag,
    assets: names.map((name, i) => ({ id: i, name, size: 1, browser_download_url: `https://x/${tag}/${name}` })),
    ...extra,
  });
  const releases = [rel("v0.15.0", ["oovi-Setup-0.15.0.exe"]), rel("v0.14.1", ["oovi-0.14.1.apk"], { prerelease: true }), rel("v0.14.0", ["oovi-0.14.0.apk", "oovi-0.14.0.aab"])];
  assert.equal(newestAsset("android", releases)?.name, "oovi-0.14.0.apk");
  assert.equal(newestAsset("android", [rel("v0.15.0", [])]), undefined);
  assert.equal(newestAsset("windows", releases)?.name, "oovi-Setup-0.15.0.exe");
});
