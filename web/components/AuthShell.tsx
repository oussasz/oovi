import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { Slime } from "./Slime";
import { Sparkle, MotionTicks } from "./Doodles";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="container auth-shell">
        <div className="auth-art" aria-hidden>
          <Sparkle size={40} style={{ position: "absolute", left: "62%", top: "6%" }} />
          <MotionTicks size={70} style={{ position: "absolute", left: "18%", top: "8%" }} />
          <Slime color="blue" shape="egg" face="dash" size="46%" style={{ left: "32%", top: "12%" }} delay={0.3} />
          <Slime color="yellow" shape="round" face="smile" size="40%" style={{ left: "6%", top: "38%" }} delay={1.1} />
          <Slime color="coral" shape="lump" face="happy" extra="curl" size="44%" style={{ left: "42%", top: "40%" }} />
        </div>
        <div className="card auth-card">{children}</div>
      </main>
    </>
  );
}
