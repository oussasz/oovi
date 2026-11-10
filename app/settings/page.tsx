"use client";

// Settings is a floating window now. Old links to /settings open it over the home page.
// (A server redirect didn't: in-app navigation never re-checked the address, so the window stayed closed.)
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { openSettings } from "@/components/SettingsModal";

function OpenSettings() {
  const router = useRouter();
  const tab = useSearchParams().get("tab") ?? undefined;
  useEffect(() => {
    router.replace("/");
    // On a fresh load this effect runs before the Settings window (mounted by the app shell) listens: open it next tick.
    const t = setTimeout(() => openSettings(tab), 0);
    return () => clearTimeout(t);
  }, [router, tab]);
  return null;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <OpenSettings />
    </Suspense>
  );
}
