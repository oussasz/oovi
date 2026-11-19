"use client";

// The same app runs at /m (the phone, installable) and /app (the web version, any browser): every link goes
// through `to`, so it stays in the version that is open. The screens only render in the browser (MobileApp waits
// until it is ready), so reading the address here is safe.
export const base = (): "/m" | "/app" => (typeof window !== "undefined" && window.location.pathname.startsWith("/app") ? "/app" : "/m");
export const to = (path = ""): string => `${base()}${path}`;
/** The path inside the app: "/app/c/x" and "/m/c/x" both give "/c/x" ("" for the chat list). */
export const inApp = (pathname: string): string => pathname.replace(/^\/(m|app)(?=\/|$)/, "");
