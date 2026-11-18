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
