import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import localFont from "next/font/local";
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
// Only Tajawal's Arabic letters are kept here (app/fonts, SIL Open Font License: Tajawal-OFL.txt), so Latin
// letters and digits always come from Nunito, even in the Arabic interface. Its line metrics are tuned: with
// Tajawal's own (ascent 0.643 em) Arabic words sat about 3 px above the middle of buttons, pills and rows.
const arabic = localFont({
  src: [
    { path: "./fonts/tajawal-arabic-400.woff2", weight: "400", style: "normal" },
    // 600 (semi-bold Latin text in Nunito) draws Arabic in medium: Tajawal has no 600 and 700 reads too heavy.
    { path: "./fonts/tajawal-arabic-500.woff2", weight: "500 600", style: "normal" },
    { path: "./fonts/tajawal-arabic-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/tajawal-arabic-800.woff2", weight: "800", style: "normal" },
    { path: "./fonts/tajawal-arabic-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-arabic",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    { prop: "ascent-override", value: "80%" },
    { prop: "descent-override", value: "34%" },
    { prop: "line-gap-override", value: "0%" },
  ],
});

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
