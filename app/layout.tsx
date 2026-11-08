import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic, Nunito } from "next/font/google";
import AccountGate from "@/components/AccountGate";
import { I18nProvider } from "@/components/I18n";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], display: "swap", variable: "--font-nunito" });
// Nunito has no Arabic glyphs. This face only covers the Arabic range (unicode-range), so it
// sits first in the font stack and Latin text still renders in Nunito. No metric fallback:
// that local font would cover Latin too and override Nunito.
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], display: "swap", variable: "--font-arabic", adjustFontFallback: false });

export const metadata: Metadata = {
  title: "oovi",
  description: "Your own crew of AI bots: give them faces, put them in groups, let them work together, all on your own API key.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#131312" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${nunito.variable} ${arabic.variable}`} suppressHydrationWarning>
      <body>
        <I18nProvider>
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
