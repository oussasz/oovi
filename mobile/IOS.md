# oovi for iPhone: what's ready, and the steps for later

**Ready (in this folder):** the iPhone project, `mobile/ios/App` (Capacitor 8, Swift Package Manager, no CocoaPods).
Same settings as Android: app id `app.oovi.mobile`, name "oovi", it opens https://oovi.conuron.com/m, the offline page
built in (`www/offline.html`), user agent ends with `ooviApp/1.0` (the website then hides "Add to Home Screen"),
microphone text for voice notes (`App/Info.plist`, `NSMicrophoneUsageDescription`), icon and launch screen from the
oovi logo (`node mobile/scripts/native-icons.cjs`).

**Not done, not checked:** it was never built, signed or opened on an iPhone (that needs a Mac). Nothing below has been
tried yet.

## What you need (once)
1. **An Apple Developer account**: $99 a year. https://developer.apple.com/programs/enroll/ → "Start your enrollment".
   As a person (your own name shows in the App Store) or as a company (needs a D-U-N-S number, takes longer).
   Apple checks your identity; it can take a few days.
2. **A Mac with Xcode** (free in the Mac App Store), or a Mac in the cloud: GitHub's macOS machines can build and
   upload it with a workflow (like the desktop build already does for the Mac). A rented Mac (e.g. MacinCloud) also works.

## Steps (when the account is approved)
1. In App Store Connect (https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**: platform iOS, name
   "oovi", language, bundle ID **app.oovi.mobile** (create it in the Developer site → Certificates, IDs & Profiles →
   Identifiers → **+** → App IDs → App; tick **Associated Domains**), SKU `oovi-ios`.
2. On the Mac: `cd mobile && npm ci && npx cap sync ios`, then open `mobile/ios/App/App.xcodeproj` in Xcode.
3. Xcode → target **App** → **Signing & Capabilities**: tick "Automatically manage signing", choose your team.
   Add the capability **Associated Domains** with `applinks:oovi.conuron.com` (oovi links open the app).
4. Same screen → **General**: Version = the oovi version (e.g. 0.14.0), Build = a number that grows each upload.
5. Product → **Archive** → **Distribute App** → **App Store Connect** → Upload.
6. App Store Connect → the app → **TestFlight**: add yourself and testers by email; they install the TestFlight app and
   get oovi. No review needed for your own team; outside testers need a quick Apple review.
7. For the App Store itself: screenshots (6.7" and 6.5" iPhone), description, privacy answers (the account email,
   chats synced when the user turns sync on), a demo account for Apple's reviewer, then **Submit for Review**.

## For the developer (things to finish before the first upload)
- **Universal links:** the website must serve `https://oovi.conuron.com/.well-known/apple-app-site-association`
  with `{"applinks":{"details":[{"appIDs":["<TEAMID>.app.oovi.mobile"],"components":[{"/":"/m/*"},{"/":"/m"}]}]}}`
  (Team ID from the Developer site → Membership). Not added yet because the Team ID is not known.
- **Links:** on iPhone, Capacitor opens other sites in Safari, but website pages outside the phone app (like
  `/download`) stay inside the app (Android sends them to the browser, `NavPolicy.java`). Add the same rule in Swift
  (a `WKNavigationDelegate` check in a small plugin) if that matters.
- **Back from a connector's sign-in in Safari:** the website keeps the sign-in and the app finishes it when it comes
  back to the front (same as Android). Check it on a real iPhone.
- **Microphone text in French and Arabic:** add `fr.lproj/InfoPlist.strings` and `ar.lproj/InfoPlist.strings` with
  `NSMicrophoneUsageDescription` (Xcode → File → New → Strings File, then Localize). English is in `Info.plist`.
- **Apple review risk (guideline 4.2, "minimum functionality"):** Apple can refuse apps that only show a website.
  Points in oovi's favour: sign-in, live work, approvals, voice notes, offline page. Push notifications and a native
  share target would make it stronger; add them before submitting to the App Store (TestFlight is fine without).
- **Push notifications** need an Apple Push key (Developer site → Keys → **+** → Apple Push Notifications service) put
  into the Firebase project (see docs/HANDOFF.md, "Android app" → push notifications).
