# Selling oovi through Google Play and the App Store (to check before submitting)

Written 2026-11-19, when payment moved inside the apps (`docs/HANDOFF.md` "Pay in app"). Today the apps pay through a
single-use link that opens Paddle's checkout in the browser (`POST /api/v1/billing/link`, page `/pay/<token>`). That
is fine for the desktop app and for the Android APK downloaded from oovi's website.

Before an app is published in a store, its payment rules apply and must be checked again on the stores' current
pages (they change; nothing below was verified against them):
- **Google Play**: digital goods and subscriptions used inside the app (theOovi credits, plans) normally have to use
  Google Play Billing; a button that opens an outside checkout may be refused, except where Google's programs for
  some countries allow other billing. Check the Play "Payments" policy for the countries oovi is sold in.
- **Apple App Store**: digital goods and subscriptions normally have to use Apple's in-app purchase; links to an outside
  checkout are only allowed in some cases and countries (rules changed several times since 2024). Check App Review
  Guidelines 3.1 before submitting.
- Plans bought through a store would need their own server checks (the store's receipts or notifications) to credit
  the right oovi account, like the Paddle webhook does today (`web/lib/billing.ts`).
- Until then, the store builds can hide the Subscribe / Manage subscription buttons and say where to subscribe, if a
  store's rules require it.
