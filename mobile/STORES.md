# oovi in Google Play and the App Store: the steps for later

Until then the Android app is a direct download from the website (`/download/android`, the APK). The app is built to
go into the stores without changes:

- **Same identity forever:** app id `app.oovi.mobile` (Android and iPhone). Never change it: a new id is a new app.
- **Same signing key:** the key made by the release workflow (`mobile/android/release.keystore.enc`, opened with the
  `ANDROID_KEYSTORE_PASSWORD` secret) becomes Google Play's key (step 3 below), so people who installed the APK get
  updates from Play without reinstalling.
- **AAB:** every release run already makes `oovi-<version>.aab` (attached to the private release), the file Play wants.
- **Version code always grows:** major × 1,000,000 + minor × 1,000 + patch (`mobile/scripts/version.mjs`).
- **Target SDK 36** (Android 16), above Play's current minimum. Check each year: Play raises the minimum every August
  (Play Console → Policy status warns you). To raise it: `mobile/android/variables.gradle`.
- **Permissions:** internet and microphone (voice notes) only, plus "audio settings" that Android pairs with the
  microphone. No camera, location, contacts, storage or phone-state.
- **Privacy policy inside the app:** Settings → bottom → "Privacy policy" (https://oovi.conuron.com/privacy), and Terms.
- **No "download the APK" text inside the apps:** the website hides the Android card and the APK button inside oovi's
  app (user agent `ooviApp/…`), so the iPhone app never shows them.
- **Switch the website to the stores** (no code change): in Vercel → oovi website → Settings → Environment Variables →
  add `NEXT_PUBLIC_PLAY_STORE_URL` = `https://play.google.com/store/apps/details?id=app.oovi.mobile` → redeploy.
  The download page then shows "Get it on Google Play" (with a small "No Google Play? Download the APK" link) and
  `/download/android` opens Play (`?apk=1` still gives the APK).

## Google Play

1. **Developer account:** https://play.google.com/console/signup → personal or organisation → pay the one-time
   $25 → identity check (a few days). Google's rule at the time of writing: a NEW personal account must run a
   *closed test* with at least 12 testers for 14 days before it can publish to everyone (the Console shows the
   current rule on the Dashboard). An organisation account skips this but needs a D-U-N-S number.
2. **Create the app:** Play Console → **Create app** → name "oovi", default language English (United States),
   App, Free → accept the declarations → **Create app**.
3. **App signing (important, do it before the first upload):** Test and release → Setup → **App signing** →
   "Use a different key" / **"Export and upload a key from Java keystore"**. Google gives an *encryption public key*
   file (not secret) and its PEPK tool. Ask Claude to add a one-off workflow "Export key for Play" that opens the key
   with your secret, runs PEPK with that public key and gives you the encrypted zip under Artifacts; upload the zip
   there. Result: Play signs with the same key as the APK, updates flow to APK users, and
   `web/public/.well-known/assetlinks.json` stays right. (If you let Google make a new key instead, APK users must
   uninstall and install from Play, and the fingerprint Play shows under App signing must be added to assetlinks.json.)
4. **First upload:** Test and release → Testing → **Internal testing** → Create new release → upload
   `oovi-<version>.aab` from the GitHub release (Releases → the version → Assets) → release notes → Save → Review →
   **Start rollout**. Add testers (Testers tab → an email list) and open the opt-in link on your phone.
5. **Store listing** (Grow → Store presence → Main store listing). Texts: reuse `docs/STORE-LISTING.md`:
   - App name: oovi
   - Short description (80 characters max): `Your team of AI bots in your pocket: chats, live work and approvals.`
   - Full description: the Microsoft Store description in docs/STORE-LISTING.md, first paragraph, then:
     "On your phone: see every chat with your bots, follow their work live, approve what needs your OK, send voice
     notes, and manage your connectors. Your computer does the heavy work; the cloud takes over when it's off."
     Keep the "Start free, no API key needed" part.
   - App icon 512×512: `web/public/m/icon-512.png`. Feature graphic 1024×500: to make (ask Claude, from docs/brand).
   - Phone screenshots (2 to 8, 9:16): `docs/mobile/en-light-chats.jpg`, `en-light-chat-approval.jpg`,
     `en-light-chat-live.jpg`, `en-light-group.jpg`, `en-dark-chats.jpg`, `en-light-connectors.jpg`; add French and
     Arabic listings with the `ar-*` pictures and translated texts.
   - Category: Productivity. Contact email, website https://oovi.conuron.com, privacy policy https://oovi.conuron.com/privacy.
6. **App content** (Policy → App content), the answers:
   - Privacy policy: https://oovi.conuron.com/privacy
   - Ads: No ads.
   - App access: "All or some functionality is restricted" → give a test oovi account (email + password) made for
     Google's reviewers, with sync on and a few chats.
   - Content rating: questionnaire → category "Utility, Productivity, Communication or Other"; user-generated content
     between the user and AI bots: yes (no sharing between users); no violence, sex, gambling. Expected: Everyone / PEGI 3.
   - Target audience: 18 and over (simplest; oovi isn't made for children).
   - News app: No. Government app: No. Financial features: No. Health: No.
   - **Data safety** (check against the website's real behaviour before sending; the privacy page is the reference):
     - Data collected: **Email address** (Personal info) — account; **Name** (asked at sign-up) — account;
       **Other in-app messages** (the chats, only when the user turns on cloud sync) — App functionality;
       **Voice or sound recordings** (voice notes, sent to be turned into text, not kept: tick "processed
       ephemerally") — App functionality; **Device or other IDs** (a random id for each phone, for sync) — App
       functionality. Optional answers: sync and voice notes are optional, the email is required.
     - Data shared with third parties: No (AI services that process chats on oovi's behalf count as service
       providers, not sharing, in Google's definition).
     - Encrypted in transit: Yes (HTTPS only). Users can ask for deletion: Yes (Account → Delete account on the
       website deletes the account and the synced chats).
     - No location, contacts, photos, files, health, financial or browsing data. No ads or analytics SDK in the app.
7. **Closed test → production:** Testing → Closed testing → create a track → upload the same AAB → add 12+ testers
   (if your account needs it) → wait 14 days → Production → **Create new release** → promote the tested AAB →
   **Send for review** (a few days the first time).
8. **After that, each version:** the release workflow builds the AAB; upload it to Production (or ask Claude to add
   automatic upload with a Play service account later).

## App Store (iPhone)

See `mobile/IOS.md` for the account, the Mac/Xcode steps, TestFlight and the review risk. For App Store Connect →
App Privacy, the answers match the Data safety ones above: Contact info → Email (app functionality, linked to the
user); User content → Other user content (chats, when sync is on) and Audio data (voice notes, not stored);
Identifiers → Device ID (random, for sync); no tracking. Privacy policy URL: https://oovi.conuron.com/privacy.
The iPhone app shows no APK or Android download text (the website hides them in the app), and asks for the
microphone, camera and photos with a sentence each (`ios/App/App/Info.plist`).
