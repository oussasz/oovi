import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], display: "swap", variable: "--font-nunito" });

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
    <html lang="en" className={nunito.variable}>
      <body>
        <div className="app">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
