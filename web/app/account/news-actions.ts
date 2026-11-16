"use server";

import { revalidatePath } from "next/cache";
import { setNewsOptOut } from "@/lib/announcements";
import { getServerSession } from "@/lib/session";

/** The account page's "News by email" switch. */
export async function setNewsEmails(on: boolean): Promise<{ ok: boolean }> {
  const session = await getServerSession();
  if (!session) return { ok: false };
  await setNewsOptOut(session.user.id, !on);
  revalidatePath("/account");
  return { ok: true };
}
