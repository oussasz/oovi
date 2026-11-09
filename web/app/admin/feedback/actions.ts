"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/ai-admin";
import { audit } from "@/lib/credits";
import { fdStr, ID_RE } from "@/lib/form";
import type { ActionState } from "@/components/admin/ActionForm";

export async function updateFeedback(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = fdStr(fd, "id", 30);
  if (!ID_RE.test(id)) return { errors: ["Unknown feedback."] };
  const status = fdStr(fd, "status", 20) as FeedbackStatus;
  if (!FEEDBACK_STATUSES.includes(status)) return { errors: ["Pick a status: new, reviewed or done."] };
  const note = fdStr(fd, "note", 1200).trim();
  if (note.length > 1000) return { errors: ["Keep the note under 1,000 characters."] };
  const res = await pool.query(
    `UPDATE feedback SET status = $2, admin_note = NULLIF($3, '') WHERE id = $1 RETURNING user_id`,
    [id, status, note],
  );
  if (!res.rows[0]) return { errors: ["This feedback no longer exists."] };
  await audit(admin.email, "feedback.update", res.rows[0].user_id ?? `feedback:${id}`, { feedbackId: id, status, note: note || null });
  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
  if (res.rows[0].user_id) revalidatePath(`/admin/users/${encodeURIComponent(String(res.rows[0].user_id))}`);
  return { ok: status === "done" ? "Marked done." : status === "reviewed" ? "Marked reviewed." : "Marked new." };
}
