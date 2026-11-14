"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/api";
import { audit } from "@/lib/credits";
import { fdBool, fdNum, fdStr } from "@/lib/form";
import { isEmail, normalizeSmtp, saveSmtp, sendMail, smtpStatus, type SmtpConfig } from "@/lib/mail";
import { testEmail } from "@/lib/mail-templates";
import { EVENTS, getNotifyConfig, saveNotifyConfig, sendTestNotice, type EventKey, type NotifyConfig } from "@/lib/notify";
import type { ActionState } from "@/components/admin/ActionForm";

function refresh() {
  revalidatePath("/admin/email");
  revalidatePath("/account");
}

/** Only the fields that changed, for the audit log (the password is never in here). */
function diff(before: SmtpConfig, after: SmtpConfig): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after) as (keyof SmtpConfig)[]) {
    if (before[k] !== after[k]) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}

export async function saveEmailSettings(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const errors: string[] = [];

  const host = fdStr(fd, "host", 300).trim();
  const port = fdNum(fd, "port", "Port", errors, { min: 1, max: 65535, integer: true });
  const security = fdStr(fd, "security", 20);
  const user = fdStr(fd, "user", 300).trim();
  const fromName = fdStr(fd, "fromName", 100).trim();
  const fromEmail = fdStr(fd, "fromEmail", 300).trim();
  const replyTo = fdStr(fd, "replyTo", 300).trim();
  // Never trimmed or logged: some passwords start or end with spaces.
  const password = fdStr(fd, "password", 600);

  if (security !== "ssl" && security !== "starttls") errors.push("Pick a security setting.");
  if (user.length > 254) errors.push("Username is too long (max 254 characters).");
  if (fromName.length > 60) errors.push("Sender name is too long (max 60 characters).");
  if (/[\r\n"<>]/.test(fromName)) errors.push("Sender name can't contain quotes, < or >.");
  if (fromEmail && !isEmail(fromEmail)) errors.push("Sender email doesn't look like an email address.");
  if (replyTo && !isEmail(replyTo)) errors.push("Reply-to email doesn't look like an email address.");
  if (password.length > 300) errors.push("Password is too long (max 300 characters).");
  if (/[\r\n]/.test(password)) errors.push("Password can't contain line breaks.");
  if (port === 587 && security === "ssl") errors.push("Port 587 uses STARTTLS. Choose STARTTLS, or use port 465 with SSL.");
  if (port === 465 && security === "starttls") errors.push("Port 465 uses SSL. Choose SSL, or use port 587 with STARTTLS.");

  const before = (await smtpStatus()).cfg;
  const next = normalizeSmtp({
    host,
    port,
    security,
    user,
    fromName,
    fromEmail,
    replyTo,
    requireVerified: fdBool(fd, "requireVerified"),
  });
  // normalizeSmtp quietly drops anything invalid: say so instead of saving a blank.
  if (host && next.host !== host) errors.push("Server should be a host name like smtp.example.com (no https://, no spaces).");
  if (errors.length || port === null) return { errors };

  const newPassword = password ? password : undefined;
  try {
    await saveSmtp(next, newPassword, admin.email);
    const changes: Record<string, unknown> = diff(before, next);
    if (newPassword) changes.password = "password changed";
    if (Object.keys(changes).length) await audit(admin.email, "email.settings", "smtp", changes);
  } catch (err) {
    console.error("email settings save failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Could not save. Check that AI_KEY_SECRET (or BETTER_AUTH_SECRET) is set on the server, then try again."] };
  }
  refresh();
  const s = await smtpStatus();
  return {
    ok: s.ready
      ? "Saved. Send yourself a test email to check it works."
      : "Saved. Email stays off until the server, username, password and sender email are all filled in.",
  };
}

export async function removeEmailPassword(): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    const { cfg } = await smtpStatus();
    await saveSmtp(cfg, null, admin.email);
    await audit(admin.email, "email.settings", "smtp", { password: "password removed" });
  } catch (err) {
    console.error("email password remove failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Could not remove the password. Please try again."] };
  }
  refresh();
  return { ok: "Password removed. oovi won't send emails until you add one again." };
}

export async function sendTestEmail(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const to = fdStr(fd, "to", 300).trim();
  if (!isEmail(to)) return { errors: ["Enter the email address to send the test to."] };
  if (!rateLimit(`email-test:${admin.id}`, 10, 10 * 60_000)) return { errors: ["That's a lot of tests in a short time. Please wait a few minutes."] };
  try {
    await sendMail(testEmail(to));
  } catch (err) {
    return { errors: [err instanceof Error ? err.message : "The test email couldn't be sent."] };
  }
  await audit(admin.email, "email.test", "smtp", { to }).catch(() => {});
  return { ok: `Sent to ${to}. It can take a minute to arrive; check spam too.` };
}

/** Who gets notifications, and for which events. Saved for everyone who opens the console. */
export async function saveNotificationSettings(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parts = fdStr(fd, "recipients", 3000)
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const errors: string[] = [];
  const bad = parts.filter((p) => !isEmail(p));
  if (bad.length) errors.push(`These don't look like email addresses: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}`);
  const recipients = [...new Set(parts)];
  if (recipients.length > 10) errors.push("Use at most 10 addresses.");
  if (errors.length) return { errors };

  const events = {} as Record<EventKey, boolean>;
  for (const e of EVENTS) events[e.key] = fdBool(fd, `ev_${e.key}`);
  const next: NotifyConfig = { enabled: fdBool(fd, "enabled"), recipients, events };
  try {
    const before = await getNotifyConfig();
    await saveNotifyConfig(next, admin.email);
    await audit(admin.email, "notifications.settings", "notifications", {
      enabled: { from: before.enabled, to: next.enabled },
      recipients: { from: before.recipients, to: next.recipients },
      events: EVENTS.filter((e) => before.events[e.key] !== next.events[e.key]).map((e) => `${e.key}: ${next.events[e.key] ? "on" : "off"}`),
    }).catch(() => {});
  } catch (err) {
    console.error("notification settings save failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Could not save. Please try again."] };
  }
  refresh();
  const on = EVENTS.filter((e) => next.events[e.key]).length;
  return {
    ok: !next.enabled
      ? "Saved. Notifications are off."
      : `Saved. ${on} kind${on === 1 ? "" : "s"} of notification on. Send a test to check it reaches you.`,
  };
}

export async function sendTestNotification(): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!rateLimit(`notify-test:${admin.id}`, 5, 10 * 60_000)) return { errors: ["That's a lot of tests in a short time. Please wait a few minutes."] };
  try {
    const { sent } = await sendTestNotice();
    await audit(admin.email, "notifications.test", "notifications", { to: sent }).catch(() => {});
    return { ok: `Sent to ${sent.join(", ")}. It can take a minute to arrive; check spam too.` };
  } catch (err) {
    return { errors: [err instanceof Error ? err.message : "The test couldn't be sent."] };
  }
}
