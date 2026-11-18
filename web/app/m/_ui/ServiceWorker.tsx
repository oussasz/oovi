"use client";

import { useEffect } from "react";

/** Registers the offline worker (web/public/m/sw.js) for the phone app's pages only (scope /m). */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const go = () => navigator.serviceWorker.register("/m/sw.js", { scope: "/m" }).catch(() => {});
    if (document.readyState === "complete") void go();
    else window.addEventListener("load", go, { once: true });
  }, []);
  return null;
}
