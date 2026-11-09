"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import { getPilotConfig, getPlans, planById } from "@/lib/ai-config";
import { getPilotRequest } from "@/lib/ai-admin";
import { adjustCredits, audit, setPlan } from "@/lib/credits";
import { fdNum, fdStr, ID_RE } from "@/lib/form";
import { sendMailQuietly, smtpStatus } from "@/lib/mail";
import { pilotApproved } from "@/lib/mail-templates";
import type { ActionState } from "@/components/admin/ActionForm";

function refresh(userId: string) {
  revalidatePath("/admin/pilot");
  revalidatePath("/admin");
  revalidatePath(`/admin/users/${encodeURIComponent(userId)}`);
  revalidatePath("/pilot");
  revalidatePath("/account");
}

/** Approves a request: adds the credits and puts the person on the pilot plan. */
export async function approvePilot(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = fdStr(fd, "id", 30);
  if (!ID_RE.test(id)) return { errors: ["Unknown request."] };
  const req = await getPilotRequest(id);
  if (!req) return { errors: ["This request no longer exists."] };
  if (req.status === "approved") return { errors: ["This request is already approved."] };
  const errors: string[] = [];
  const credits = fdNum(fd, "credits", "Credits", errors, { min: 0, max: 10_000_000, integer: true });
  const note = fdStr(fd, "note", 600).trim();
  if (note.length > 500) errors.push("Keep the note under 500 characters.");
  const cfg = await getPilotConfig();
  const plans = await getPlans();
  if (!plans.some((p) => p.id === cfg.plan)) errors.push(`The pilot plan “${cfg.plan}” doesn't exist. Fix it in theOovi > Pilot program first.`);
  if (errors.length || credits === null) return { errors };

  // Claim the request first, so a double click can't grant twice.
  const claimed = await pool.query(
    `UPDATE pilot_requests SET status = 'approved', credits = $2, admin_note = NULLIF($3, ''), reviewed_by = $4, reviewed_at = now()
      WHERE id = $1 AND status <> 'approved' RETURNING user_id`,
    [id, credits, note, admin.email],
  );
  if (!claimed.rows[0]) return { errors: ["This request was already approved."] };
  const userId = String(claimed.rows[0].user_id);

  try {
    if (credits > 0) await adjustCredits(userId, credits, "pilot", "Pilot program", admin.email);
  } catch (err) {
    console.error("pilot credits failed", err instanceof Error ? err.message : err);
    await pool
      .query(`UPDATE pilot_requests SET status = $2, credits = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`, [id, req.status])
      .catch(() => {});
    return { errors: ["Could not add the credits, so the request was left as it was. Please try again."] };
  }
  let planError = false;
  try {
    await setPlan(userId, cfg.plan, cfg.days, admin.email);
  } catch (err) {
    console.error("pilot plan failed", err instanceof Error ? err.message : err);
    planError = true;
  }
  await audit(admin.email, "pilot.approve", userId, { requestId: id, credits, plan: cfg.plan, days: cfg.days, note: note || null, planError });
  refresh(userId);
  if (planError) return { errors: [`The ${credits.toLocaleString("en-US")} credits were added, but the plan couldn’t be set. Set it by hand on the user’s page.`] };
  const emailed = await emailApproval(userId, credits, cfg.plan, cfg.days);
  return {
    ok: `Approved: ${credits.toLocaleString("en-US")} credits and the ${cfg.plan} plan for ${cfg.days} days.${
      emailed === "sent" ? " They were emailed." : emailed === "failed" ? " The email to them couldn’t be sent." : ""
    }`,
  };
}

/** Tells the person by email. Never fails the approval: email may not be set up. */
async function emailApproval(userId: string, credits: number, planId: string, days: number): Promise<"sent" | "failed" | "off"> {
  try {
    if (!(await smtpStatus()).ready) return "off";
    const { rows } = await pool.query<{ email: string; name: string | null }>(`SELECT email, name FROM "user" WHERE id = $1`, [userId]);
    const u = rows[0];
    if (!u) return "off";
    const plan = await planById(planId);
    return (await sendMailQuietly(pilotApproved(u.email, u.name ?? "", credits, days, plan.dailyLimit))) ? "sent" : "failed";
  } catch (err) {
    console.error("pilot approval email failed", err instanceof Error ? err.message : "unknown error");
    return "failed";
  }
}

export async function rejectPilot(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = fdStr(fd, "id", 30);
  if (!ID_RE.test(id)) return { errors: ["Unknown request."] };
  const note = fdStr(fd, "note", 600).trim();
  if (note.length > 500) return { errors: ["Keep the note under 500 characters."] };
  const res = await pool.query(
    `UPDATE pilot_requests SET status = 'rejected', admin_note = NULLIF($2, ''), reviewed_by = $3, reviewed_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING user_id`,
    [id, note, admin.email],
  );
  if (!res.rows[0]) return { errors: ["Only pending requests can be rejected."] };
  const userId = String(res.rows[0].user_id);
  await audit(admin.email, "pilot.reject", userId, { requestId: id, note: note || null });
  refresh(userId);
  return { ok: "Rejected." };
}
