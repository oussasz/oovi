import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { LogoMark } from "./LogoMark";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="container auth-shell">
        <div className="auth-art" aria-hidden>
          <LogoMark size="min(78%, 340px)" priority />
        </div>
        <div className="card auth-card">{children}</div>
      </main>
    </>
  );
}
