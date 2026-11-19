"use client";

// The phone app lives at /m (only inside oovi's Android app since 2026-11-19; the web version at /app was removed):
// every link goes through `to`. The screens only render in the browser (MobileApp waits
// until it is ready), so reading the address here is safe.
export const base = (): "/m" => "/m";
export const to = (path = ""): string => `${base()}${path}`;
/** The path inside the app: "/m/c/x" gives "/c/x" ("" for the chat list). */
export const inApp = (pathname: string): string => pathname.replace(/^\/m(?=\/|$)/, "");
