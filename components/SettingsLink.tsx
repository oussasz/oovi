"use client";

import type { ReactNode } from "react";
import { openSettings } from "./SettingsModal";

/**
 * A link that opens the Settings window (on a tab). A plain <Link href="/settings"> doesn't: the window
 * reads the address only when the app starts, so in-app navigation landed on the home page instead.
 * The href stays for "open in new window" and for screen readers.
 */
export default function SettingsLink({ tab, children, className }: { tab?: string; children: ReactNode; className?: string }) {
  return (
    <a
      href="/settings"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openSettings(tab);
      }}
    >
      {children}
    </a>
  );
}
