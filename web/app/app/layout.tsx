// The web version of oovi (/app): the same app as the phone (/m), in any browser, two columns on wide screens.
// Signed-in only: every API call checks the session, and a signed-out visitor is sent to the website's sign-in
// page and back (MobileApp). Not installable (no manifest or offline worker: that is the phone's /m).
import type { Metadata, Viewport } from "next";
import { MobileApp } from "../m/_ui/MobileApp";
import { WideFrame } from "../m/_ui/WideFrame";
import { arabic, PREPAINT } from "../m/_ui/shell";
import "../m/m.css";

export const metadata: Metadata = {
  title: { default: "oovi", template: "%s · oovi" },
  description: "Your oovi bots in your browser: chats, live work and approvals.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#151513" },
  ],
};

export default function WebAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PREPAINT }} />
      <div className={arabic.variable}>
        <MobileApp>
          <WideFrame>{children}</WideFrame>
        </MobileApp>
      </div>
    </>
  );
}
