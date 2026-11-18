"use client";

/** A light tap where the phone supports it (Android). iPhones give no web vibration: the screen's spring is the feedback. */
export function tap(kind: "light" | "medium" | "success" | "warning" = "light") {
  try {
    const ms = kind === "light" ? 8 : kind === "medium" ? 14 : kind === "success" ? [10, 40, 10] : [20, 60, 20];
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
