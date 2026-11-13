"use client";

import { useEffect } from "react";

const KEY = "oovi_ft";

/** The first place this visitor came from ("google.com", "newsletter:email" or "direct"), kept only in their browser until they sign up. */
export function firstTouch(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Remembers, on a person's first visit, which site or campaign sent them. Nothing leaves the browser until they sign up. */
export function FirstTouch() {
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return;
      const p = new URLSearchParams(location.search);
      const campaign = p.get("utm_source") || p.get("ref") || p.get("source");
      const medium = p.get("utm_medium");
      let host = "";
      try {
        host = new URL(document.referrer).hostname.replace(/^www\./, "");
      } catch {
        host = "";
      }
      if (host === location.hostname.replace(/^www\./, "")) host = "";
      const value = campaign ? (medium ? `${campaign}:${medium}` : campaign) : host || "direct";
      localStorage.setItem(KEY, value.slice(0, 80));
    } catch {
      // Storage blocked: sign-up works the same without it.
    }
  }, []);
  return null;
}
