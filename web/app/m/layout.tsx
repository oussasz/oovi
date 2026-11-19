// The phone app (installable web app): its own look (iOS style, m.css), manifest, icons, launch screens and
// offline service worker (web/public/m/). It uses the website's sign-in and API; it never asks for or keeps an
// API key. Pages are client screens: data comes only from the signed-in API calls, never from the HTML.
import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import { MobileApp } from "./_ui/MobileApp";
import { ServiceWorker } from "./_ui/ServiceWorker";
import { splashLinks } from "./_lib/splash";
import "./m.css";

// Nunito (the website's font) has no Arabic letters: Tajawal is its rounded, friendly match for Arabic.
const arabic = Tajawal({ subsets: ["arabic"], weight: ["400", "500", "700", "800"], variable: "--font-ar", display: "swap" });

// Title and the like only: Next streams metadata into <body> on pages rendered per request (the chat page), and
// browsers look for the install tags in <head>. Those are rendered below (InstallTags): React puts them in <head>.
export const metadata: Metadata = {
  title: { default: "oovi", template: "%s · oovi" },
  description: "Your oovi bots on your phone: chats, live work and approvals.",
  applicationName: "oovi",
  // Same files as InstallTags, so the website's own icon (/mark.png) is never offered for the phone app.
  icons: { icon: [{ url: "/m/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/m/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

// Before the first paint: the phone's saved language and look, so Arabic opens right-to-left at once.
const PREPAINT = `try{var p=JSON.parse(localStorage.getItem("oovi.m.prefs")||"{}");var l=p.lang&&p.lang!=="auto"?p.lang:null;if(!l){var n=(navigator.languages||[navigator.language]);for(var i=0;i<n.length;i++){var c=String(n[i]).slice(0,2).toLowerCase();if(c==="ar"||c==="fr"||c==="en"){l=c;break}}}l=l||"en";var h=document.documentElement;h.lang=l;h.dir=l==="ar"?"rtl":"ltr";h.dataset.mtheme=p.theme||"auto";h.classList.add("m-root")}catch(e){}`;

/** Manifest, icons and iPhone launch screens: "Add to Home Screen" on iPhone and Android, on every page of the app. */
function InstallTags() {
  return (
    <>
      <link rel="manifest" href="/m/manifest.webmanifest" />
      <link rel="icon" href="/m/icon-192.png" sizes="192x192" type="image/png" />
      <link rel="apple-touch-icon" href="/m/apple-touch-icon.png" sizes="180x180" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="oovi" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      {splashLinks().map((s) => (
        <link key={s.url} rel="apple-touch-startup-image" href={s.url} media={s.media} />
      ))}
    </>
  );
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InstallTags />
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      <div className={arabic.variable}>
        <MobileApp>{children}</MobileApp>
      </div>
      <ServiceWorker />
    </>
  );
}
