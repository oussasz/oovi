"use client";

import { ApiError, startSignIn } from "../_lib/api";
import type { Key } from "../_lib/i18n";

export const FLOW_KEY = "oovi.m.flow";

/**
 * Starts a connector's sign-in (OAuth through the website) and opens the service's page in this window: in the app
 * added to the Home Screen it stays in the same session when the phone allows it. If it comes back in another
 * browser (iPhone: Safari), the app finishes it when it comes to the front again (MobileApp, GET /vault pending).
 * Answers the words to show when it could not start.
 */
export async function beginSignIn(id: string, url?: string): Promise<Key | null> {
  try {
    const r = await startSignIn(id, url);
    // The service's own page, over https (http only for a test server on this machine).
    if (!r?.authUrl || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)/i.test(r.authUrl)) return "conn.err.failed";
    try {
      sessionStorage.setItem(FLOW_KEY, JSON.stringify({ flowId: r.flowId, id, at: Date.now() }));
    } catch {
      /* private mode: the check on return still runs every minute */
    }
    window.location.href = r.authUrl;
    return null;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "sync_off") return "conn.err.sync_off";
      if (err.status === 502) return "conn.err.refused";
      if (err.status === 0) return "chat.sendFailed";
    }
    return "conn.err.failed";
  }
}

/** A sign-in was started from this phone in the last 15 minutes (so coming back checks for it at once). */
export function signInRecent(): boolean {
  try {
    const f = JSON.parse(sessionStorage.getItem(FLOW_KEY) || "null") as { at?: number } | null;
    return !!f?.at && Date.now() - f.at < 15 * 60_000;
  } catch {
    return false;
  }
}
