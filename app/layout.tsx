import type { Metadata, Viewport } from "next";
import { Nunito, Tajawal } from "next/font/google";
import AccountGate from "@/components/AccountGate";
import { I18nProvider } from "@/components/I18n";
import Sidebar from "@/components/Sidebar";
import { UpdateBanner } from "@/components/Updates";
import { Announcements } from "@/components/Announcements";
import "./globals.css";
import "./styles/updates.css";
import "./styles/attachments.css";
import "./styles/memory.css";
import "./styles/files.css";
import "./styles/desktop.css";
import "./styles/telegram.css";
import "./styles/live-browser.css";
import "./styles/routines.css";

const nunito = Nunito({ subsets: ["latin"], display: "swap", variable: "--font-nunito" });
// Nunito has no Arabic glyphs: Tajawal is its rounded match for Arabic (the same pair as the phone and web app).
// next/font's `subsets` only chooses what is preloaded: the CSS still declares every subset of a face, so the
// order in the font stack decides (globals.css): Nunito first, Tajawal first only when the app is in Arabic.
const arabic = Tajawal({ subsets: ["arabic"], weight: ["400", "500", "700", "800", "900"], display: "swap", variable: "--font-arabic" });

export const metadata: Metadata = {
  title: "oovi",
  description: "Your own crew of AI bots: give them faces, put them in groups, let them work together, all on your own API key.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${nunito.variable} ${arabic.variable}`} suppressHydrationWarning>
      <body>
        <I18nProvider>
          <UpdateBanner />
          <Announcements />
          <AccountGate>
            <div className="app">
              <Sidebar />
              <main className="main">{children}</main>
            </div>
          </AccountGate>
        </I18nProvider>
      </body>
    </html>
  );
}
