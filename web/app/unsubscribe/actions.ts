"use server";

import { readUnsubToken, setNewsOptOut } from "@/lib/announcements";

export type UnsubState = { done?: "out" | "in"; error?: string } | null;

/** From the link in a news email: stop (or restart) oovi news for that person. */
export async function changeNews(_prev: UnsubState, fd: FormData): Promise<UnsubState> {
  const userId = readUnsubToken(String(fd.get("t") ?? ""));
  if (!userId) return { error: "This link doesn’t work. Copy the whole link from the email, or change it in Settings in the oovi web app." };
  const out = fd.get("action") !== "in";
  await setNewsOptOut(userId, out);
  return { done: out ? "out" : "in" };
}
