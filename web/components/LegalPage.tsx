import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { SiteFooter } from "./SiteFooter";
import { LEGAL_LAST_UPDATED, TERMS_VERSION } from "@/lib/legal";

export function Ph({ children }: { children: ReactNode }) {
  return <span className="placeholder">{children}</span>;
}

export function LegalPage({ title, summary, children }: { title: string; summary: ReactNode; children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="container page">
        <article className="legal">
          <h1>{title}</h1>
          <p className="meta">
            Version {TERMS_VERSION} · Last updated: {LEGAL_LAST_UPDATED}
          </p>
          <div className="summary">{summary}</div>
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
