import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  // The site moved to oovi.conuron.com. Pages on the old address redirect there; /api stays
  // on both so installed apps that still use the old address keep working.
  async redirects() {
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "oovi.vercel.app" }],
        destination: "https://oovi.conuron.com/:path",
        permanent: true,
      },
      // Owner, 2026-11-19 (docs/CLOUD-BUILD.md, 8ab4a7d): no web version and no account on the website; everything
      // is in the apps. The web app, sign-in, sign-up and the account page lead to the download page.
      ...["/app", "/app/:path*", "/login", "/signup", "/account", "/account/:path*"].map((source) => ({ source, destination: "/download", permanent: true })),
      // The phone app's pages open only inside oovi's Android app (its web view adds "ooviApp/<version>" to the user
      // agent, mobile/capacitor.config.json on branch android-app). An ordinary browser goes to the download page.
      // Files (the offline worker, icons, launch screens) stay reachable. Data is protected by sign-in anyway.
      ...["/m", "/m/:path((?!.*\\.).*)"].map((source) => ({
        source,
        missing: [{ type: "header", key: "user-agent", value: ".*ooviApp/.*" }],
        destination: "/download",
        permanent: false,
      })),
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // No framing anywhere, except the console's email previews inside the console itself.
      {
        source: "/:path((?!admin/email/preview$).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/admin/email/preview",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      // The phone app's offline worker (web/public/m/sw.js) serves the app's pages at /m and /m/…; it is never
      // kept stale by the browser's cache.
      {
        source: "/m/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/m" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
};

export default withBotId(nextConfig);
