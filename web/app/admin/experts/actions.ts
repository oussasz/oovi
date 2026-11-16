"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/credits";
import { fdStr, ID_RE } from "@/lib/form";
import { setApplicationStatus } from "@/lib/expert-db";
import { STATUSES, type ExpertStatus } from "@/lib/expert-form";

/** Accept, decline, or put back to "new" (every change can be undone). Accepting publishes nothing. */
export async function reviewApplication(status: ExpertStatus, fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = fdStr(fd, "id", 30);
  if (!ID_RE.test(id) || !STATUSES.includes(status)) return;
  const note = fdStr(fd, "note", 700).trim().slice(0, 500);
  const prev = await setApplicationStatus(id, status, admin.email, note);
  if (prev === null) return;
  await audit(admin.email, `expert.${status === "new" ? "reopen" : status === "accepted" ? "accept" : "decline"}`, id, { from: prev, note: note ? true : false }).catch(() => {});
  revalidatePath("/admin/experts");
  redirect(`/admin/experts/view?id=${id}&done=${status}`);
}
