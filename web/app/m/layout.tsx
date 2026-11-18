// The phone app (installable web app): its own look (iOS style, m.css), manifest, icons, launch screens and
// offline service worker (web/public/m/). It uses the website's sign-in and API; it never asks for or keeps an
// API key. Pages are client screens: data comes only from the signed-in API calls, never from the HTML.
import type { Metadata, Viewport } from "next";
import { MobileApp } from "./_ui/MobileApp";
import { ServiceWorker } from "./_ui/ServiceWorker";
import { splashLinks } from "./_lib/splash";
import "./m.css";

export const metadata: Metadata = {
  title: { default: "oovi", template: "%s · oovi" },
  description: "Your oovi bots on your phone: chats, live work and approvals.",
  manifest: "/m/manifest.webmanifest",
  applicationName: "oovi",
  appleWebApp: {
    capable: true,
    title: "oovi",
    statusBarStyle: "default",
    startupImage: splashLinks(),
  },
  icons: {
    icon: [
      { url: "/m/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/m/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/m/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Before the first paint: the phone's saved language and look, so Arabic opens right-to-left at once.
const PREPAINT = `try{var p=JSON.parse(localStorage.getItem("oovi.m.prefs")||"{}");var l=p.lang&&p.lang!=="auto"?p.lang:null;if(!l){var n=(navigator.languages||[navigator.language]);for(var i=0;i<n.length;i++){var c=String(n[i]).slice(0,2).toLowerCase();if(c==="ar"||c==="fr"||c==="en"){l=c;break}}}l=l||"en";var h=document.documentElement;h.lang=l;h.dir=l==="ar"?"rtl":"ltr";h.dataset.mtheme=p.theme||"auto";h.classList.add("m-root")}catch(e){}`;

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      <MobileApp>{children}</MobileApp>
      <ServiceWorker />
    </>
  );
}
