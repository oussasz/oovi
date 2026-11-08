import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { DownloadChooser } from "@/components/download/DownloadChooser";
import { Slime } from "@/components/Slime";

export const metadata: Metadata = {
  title: "Download",
  description: "Download oovi for Mac (Apple silicon or Intel) and Windows.",
};

export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <SiteNav />
      <main className="container page page-narrow">
        <div className="page-head">
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }} aria-hidden>
            <Slime color="blue" shape="egg" face="dash" size={56} />
            <Slime color="yellow" shape="round" face="smile" size={48} delay={0.6} />
            <Slime color="coral" shape="lump" face="happy" size={52} delay={1.2} />
          </div>
          <h1 className="h2">Download oovi</h1>
          <p className="lead small">
            oovi runs on your computer. Pick your system below, then sign in with your oovi account inside the app.
          </p>
        </div>
        {error === "unavailable" && (
          <p className="alert alert-error" role="alert" style={{ marginBottom: 20 }}>
            Sorry, the download isn’t available right now. Please try again in a few minutes. If it keeps happening,
            let us know.
          </p>
        )}
        <div className="card">
          <DownloadChooser />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
