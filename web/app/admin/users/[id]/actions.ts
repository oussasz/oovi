"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { getPlans } from "@/lib/ai-config";
import { userExists } from "@/lib/ai-admin";
import { adjustCredits, audit, resetToday, setAiEnabled, setBlocked, setDailyOverride, setPlan } from "@/lib/credits";
import { fdNum, fdStr } from "@/lib/form";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { rateLimit } from "@/lib/api";
import { smtpStatus } from "@/lib/mail";
import type { ActionState } from "@/components/admin/ActionForm";

function refresh(userId: string) {
  revalidatePath(`/admin/users/${encodeURIComponent(userId)}`);
  revalidatePath("/admin/users");
}

/** Every action names its target account; it must exist. */
async function target(fd: FormData): Promise<string | null> {
  const id = fdStr(fd, "userId", 300);
  return (await userExists(id)) ? id : null;
}

const fail = (err: unknown, what: string): ActionState => {
  console.error(`${what} failed`, err instanceof Error ? err.message : err);
  return { errors: ["Could not save. Please try again."] };
};

export async function adjustCreditsAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const errors: string[] = [];
  const amount = fdNum(fd, "amount", "Amount", errors, { min: -10_000_000, max: 10_000_000 });
  if (amount !== null && amount === 0) errors.push("Amount can't be 0. Use a negative number to remove credits.");
  if (amount !== null && Math.round(amount * 1000) !== amount * 1000) errors.push("Amount can have at most 3 decimals.");
  const note = fdStr(fd, "note", 400).trim();
  if (note.length < 3 || note.length > 300) errors.push("Add a short note (3 to 300 characters) saying why. It’s kept in the credit history.");
  if (errors.length || amount === null) return { errors };
  try {
    await adjustCredits(userId, amount, "admin", note, admin.email);
    await audit(admin.email, "credits.adjust", userId, { credits: amount, note });
  } catch (err) {
    return fail(err, "credit adjust");
  }
  refresh(userId);
  return { ok: `${amount > 0 ? "Added" : "Removed"} ${Math.abs(amount).toLocaleString("en-US")} credits.` };
}

export async function setPlanAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const errors: string[] = [];
  const planId = fdStr(fd, "plan", 40);
  const plans = await getPlans();
  const plan = plans.find((p) => p.id === planId);
  if (!plan) errors.push("Pick a plan that exists.");
  const days = fdNum(fd, "days", "Number of days", errors, { min: 1, max: 3650, integer: true });
  if (errors.length || !plan || days === null) return { errors };
  try {
    await setPlan(userId, plan.id, days, admin.email);
    await audit(admin.email, "plan.set", userId, { plan: plan.id, days: plan.id === "free" ? null : days, creditsAdded: plan.id === "free" ? 0 : plan.monthlyCredits });
  } catch (err) {
    return fail(err, "set plan");
  }
  refresh(userId);
  return {
    ok:
      plan.id === "free"
        ? "Moved to the Free plan."
        : `Now on ${plan.name} for ${days} days. ${plan.monthlyCredits.toLocaleString("en-US")} credits added.`,
  };
}

export async function setOverrideAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const clear = fdStr(fd, "mode", 10) === "clear";
  const errors: string[] = [];
  const limit = clear ? null : fdNum(fd, "limit", "Daily limit", errors, { min: 0, max: 100_000_000, integer: true });
  if (errors.length) return { errors };
  try {
    await setDailyOverride(userId, limit);
    await audit(admin.email, clear ? "limit.clear" : "limit.set", userId, { dailyLimit: limit });
  } catch (err) {
    return fail(err, "daily override");
  }
  refresh(userId);
  return { ok: limit === null ? "Daily limit now follows the plan." : `Daily limit set to ${limit === 0 ? "no limit" : `${limit.toLocaleString("en-US")} credits`}.` };
}

export async function resetTodayAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  try {
    await resetToday(userId);
    await audit(admin.email, "usage.reset_today", userId, null);
  } catch (err) {
    return fail(err, "reset today");
  }
  refresh(userId);
  return { ok: "Today’s usage reset to 0." };
}

export async function setAiEnabledAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const enabled = fdStr(fd, "enabled", 10) === "true";
  try {
    await setAiEnabled(userId, enabled);
    await audit(admin.email, enabled ? "ai.user_on" : "ai.user_off", userId, null);
  } catch (err) {
    return fail(err, "set ai enabled");
  }
  refresh(userId);
  return { ok: enabled ? "theOovi turned on for this account." : "theOovi turned off for this account." };
}

export async function setBlockedAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const block = fdStr(fd, "blocked", 10) === "true";
  const reason = fdStr(fd, "reason", 400).trim();
  if (block) {
    if (userId === admin.id) return { errors: ["You can't block your own account."] };
    if (reason.length < 3 || reason.length > 300) return { errors: ["Give a reason (3 to 300 characters). It’s kept on the account and in the audit log."] };
  }
  try {
    await setBlocked(userId, block, block ? reason : null);
    await audit(admin.email, block ? "account.block" : "account.unblock", userId, block ? { reason } : null);
  } catch (err) {
    return fail(err, "block");
  }
  refresh(userId);
  return { ok: block ? "Account blocked and signed out everywhere." : "Account unblocked. They can sign in again." };
}

// ---------- email confirmation ----------

export async function markEmailVerifiedAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  try {
    const res = await pool.query(`UPDATE "user" SET "emailVerified" = true, "updatedAt" = now() WHERE id = $1 AND "emailVerified" = false`, [userId]);
    if (!res.rowCount) return { ok: "This email was already confirmed." };
    await audit(admin.email, "email.mark_verified", userId, null);
  } catch (err) {
    return fail(err, "mark email verified");
  }
  refresh(userId);
  return { ok: "Email marked as confirmed." };
}

export async function resendVerificationAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = await target(fd);
  if (!userId) return { errors: ["This account no longer exists."] };
  const { rows } = await pool.query<{ email: string; emailVerified: boolean }>(`SELECT email, "emailVerified" FROM "user" WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u) return { errors: ["This account no longer exists."] };
  if (u.emailVerified) return { ok: "This email is already confirmed." };
  if (!(await smtpStatus()).ready) return { errors: ["Email isn't set up yet. Add the mail server in Email first."] };
  if (!rateLimit(`admin-verify-mail:${userId}`, 3, 10 * 60_000)) return { errors: ["A few emails were sent to this person already. Wait a few minutes."] };
  try {
    await auth.api.sendVerificationEmail({ body: { email: u.email, callbackURL: "/verified" } });
    await audit(admin.email, "email.resend_verification", userId, null);
  } catch (err) {
    console.error("admin resend verification failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Couldn't send the email. Try a test email on the Email page to check the settings."] };
  }
  return { ok: `Confirmation email sent to ${u.email}.` };
}
