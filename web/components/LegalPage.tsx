import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { SiteFooter } from "./SiteFooter";
import { LEGAL_LAST_UPDATED, TERMS_VERSION } from "@/lib/legal";

/** A value from lib/legal.ts. Highlighted only while it's still an unfilled "[PLACEHOLDER]". */
export function Ph({ children }: { children: ReactNode }) {
  const text = typeof children === "string" ? children : "";
  if (text.includes("@") && !text.startsWith("[")) return <a href={`mailto:${text}`}>{text}</a>;
  return <span className={/^\[.*\]$/.test(text) ? "placeholder" : undefined}>{children}</span>;
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
