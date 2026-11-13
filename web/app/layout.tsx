import type { Metadata, Viewport } from "next";
import { Caveat, Nunito } from "next/font/google";
import { DownloadProvider } from "@/components/download/DownloadProvider";
import { FirstTouch } from "@/components/FirstTouch";
import { siteUrl } from "@/lib/site";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], variable: "--font-hand", display: "swap", weight: ["500", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "oovi · Your own team of AI agents",
    template: "%s · oovi",
  },
  description:
    "Meet oovi. Your own team of AI agents, working together on your computer to turn your ideas into reality. Bring your own AI key.",
  icons: { icon: "/mark.png", apple: "/mark.png" },
  openGraph: {
    title: "oovi · You have a team. They just happen to be AI.",
    description: "Your own team of AI agents, working together to turn your ideas into reality.",
    images: ["/mark.png"],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${caveat.variable}`}>
      <body>
        <FirstTouch />
        <DownloadProvider>{children}</DownloadProvider>
      </body>
    </html>
  );
}
