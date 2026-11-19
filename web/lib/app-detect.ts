// Which shell is showing the website (pure, tests/unit/mobile-native.test.mts). oovi's phone apps (mobile/, Capacitor)
// add "ooviApp/<version>" to the browser's user agent (capacitor.config.json appendUserAgent).

/** oovi's own phone app (Android or iPhone). */
export function isNativeApp(ua: string | null | undefined): boolean {
  return /(^|\s)ooviApp\/\d/.test(ua ?? "");
}

/** A browser on an Android phone or tablet (not oovi's app): where "Get the Android app" makes sense. */
export function isAndroidBrowser(ua: string | null | undefined): boolean {
  return /\bAndroid\b/i.test(ua ?? "") && !isNativeApp(ua);
}
