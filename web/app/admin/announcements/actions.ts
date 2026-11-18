"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/api";
import { audit } from "@/lib/credits";
import { isEmail, sendMail, smtpStatus } from "@/lib/mail";
import { pool } from "@/lib/db";
import { MAX_MESSAGE, MAX_PEOPLE, audienceLabel, paragraphs, parsePeople, peopleOf } from "@/lib/announcement-audience";
import { personalMessage } from "@/lib/mail-templates";
import { announcementEmail, deleteAnnouncement, emailCounts, emailRecipients, getAnnouncement, LIMITS, recordEvent, saveAnnouncement, setStatus, type AnnInput, type AnnStatus } from "@/lib/announcements";

export type AnnState = { ok?: string; errors?: string[]; id?: string } | null;
const PER_RUN = 150;

function readInput(fd: FormData): AnnInput | string[] {
  const s = (k: string, max: number) => String(fd.get(k) ?? "").slice(0, max);
  const title = s("title", LIMITS.title + 50).replace(/\s+/g, " ").trim();
  const barText = s("barText", LIMITS.barText + 50).replace(/\s+/g, " ").trim();
  const html = s("html", LIMITS.html + 1000);
  const people = parsePeople(s("people", 40_000));
  const message = s("message", MAX_MESSAGE + 500).replace(/\r\n?/g, "\n").trim();
  const audience = s("audience", 10);
  const endsOn = s("endsOn", 20).trim();
  const v: AnnInput = {
    title,
    barText,
    html,
    email: fd.get("email") === "on",
    window: fd.get("window") === "on",
    bar: fd.get("bar") === "on",
    testEmail: audience === "chosen" ? people.emails.join(",") : "",
    message: audience === "chosen" ? message : "",
    startsAt: null,
    endsAt: /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? new Date(`${endsOn}T23:59:59Z`).toISOString() : null,
  };
  const errors: string[] = [];
  if (!title) errors.push("Write a title (it is also the email subject).");
  if (title.length > LIMITS.title) errors.push(`Keep the title under ${LIMITS.title} characters.`);
  if (barText.length > LIMITS.barText) errors.push(`Keep the bar text under ${LIMITS.barText} characters.`);
  if (!html.trim()) errors.push("Add the HTML (the starter template is a good start).");
  if (html.length > LIMITS.html) errors.push("The HTML is too big (over 200 KB). Put pictures online and link them instead of embedding them.");
  if (!v.email && !v.window && !v.bar) errors.push("Choose at least one channel: email, window in the app or bar in the app.");
  if (audience !== "chosen" && audience !== "all") errors.push("Choose who sees it: the people you choose, or everyone.");
  if (audience === "chosen") {
    if (people.bad.length) errors.push(`These don't look like email addresses: ${people.bad.slice(0, 5).join(", ")}${people.bad.length > 5 ? "…" : ""}`);
    else if (!people.emails.length) errors.push("Write at least one email address (one per line).");
    if (fd.get("email") === "on" && !message) errors.push("Write the message these people get by email.");
    if (message.length > MAX_MESSAGE) errors.push(`Keep the message under ${MAX_MESSAGE} characters.`);
    if (people.emails.length > MAX_PEOPLE) errors.push(`That is ${people.emails.length} addresses. Keep the list under ${MAX_PEOPLE}, or choose Everyone.`);
  }
  return errors.length ? errors : v;
}

/** Create or update (a live announcement is updated for everyone at once). */
export async function saveAnn(_prev: AnnState, fd: FormData): Promise<AnnState> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (id && !/^\d{1,18}$/.test(id)) return { errors: ["Unknown announcement."] };
  const v = readInput(fd);
  if (Array.isArray(v)) return { errors: v };
  const saved = await saveAnnouncement(id || null, v, admin.email);
  await audit(admin.email, id ? "announcement.edit" : "announcement.create", `announcement:${saved}`, { title: v.title, people: peopleOf(v.testEmail).length || null });
  revalidatePath("/admin/announcements");
  return { ok: "Saved.", id: saved };
}

export async function changeStatus(id: string, status: AnnStatus): Promise<AnnState> {
  const admin = await requireAdmin();
  const a = await getAnnouncement(id);
  if (!a) return { errors: ["This announcement no longer exists."] };
  await setStatus(id, status);
  await audit(admin.email, `announcement.${status}`, `announcement:${id}`, { title: a.title, people: peopleOf(a.testEmail).length || null });
  revalidatePath("/admin/announcements");
  return { ok: status === "live" ? (a.testEmail ? `Live for ${audienceLabel(a.testEmail)} only.` : "Live for everyone.") : status === "ended" ? "Ended: nobody sees it anymore." : "Back to draft." };
}

export async function removeAnn(id: string): Promise<AnnState> {
  const admin = await requireAdmin();
  const a = await getAnnouncement(id);
  if (!a) return { ok: "Already deleted." };
  await deleteAnnouncement(id);
  await audit(admin.email, "announcement.delete", `announcement:${id}`, { title: a.title });
  revalidatePath("/admin/announcements");
  return { ok: "Deleted." };
}

/** The next batch of emails to the audience (150 per press; chosen people only when the announcement names them). */
export async function sendAnnEmails(id: string): Promise<AnnState> {
  const admin = await requireAdmin();
  if (!rateLimit(`ann-mail:${admin.id}`, 6, 10 * 60_000)) return { errors: ["You just sent a batch. Please wait a few minutes."] };
  const a = await getAnnouncement(id);
  if (!a) return { errors: ["This announcement no longer exists."] };
  if (!a.email) return { errors: ["Email isn't one of this announcement's channels. Tick Email and save first."] };
  if (!a.testEmail && a.status !== "live") return { errors: ["Make it live first (or choose the people it is for)."] };
  const mail = await smtpStatus().catch(() => null);
  if (mail && !mail.ready) return { errors: ["Email isn't set up yet: add the mail server in Admin > Email first."] };
  const people = await emailRecipients(a, PER_RUN);
  if (a.testEmail && !a.message.trim()) return { errors: ["Write the message first (under “Who sees it”), then save."] };
  if (!people.length) return { ok: a.testEmail ? "Nobody left to email: the people you chose have it already, or have no oovi account (see the list under “Who sees it”)." : "Everyone in the audience has it already (or unsubscribed)." };
  let sent = 0;
  const failed: string[] = [];
  for (const p of people) {
    try {
      // Chosen people get an ordinary email with the owner's words; everyone gets the news email (HTML, unsubscribe link).
      await sendMail(a.testEmail ? personalMessage(p.email, a.title, paragraphs(a.message)) : announcementEmail(a, p));
      await recordEvent(a.id, p.id, "emailed").catch(() => {});
      sent++;
    } catch {
      failed.push(p.email);
    }
  }
  await audit(admin.email, "announcement.email", `announcement:${id}`, { sent, failed: failed.length }).catch(() => {});
  revalidatePath("/admin/announcements");
  const { left } = await emailCounts(a);
  const more = left > 0 ? ` ${left} left: press again to send the next batch.` : " Everyone has it now.";
  return failed.length ? { errors: [`Sent ${sent}. Couldn't send ${failed.length} (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}).${more}`] } : { ok: `Sent ${sent}.${more}` };
}

/** One copy to any address (yours, by default), to see it in a real mail app. Not counted. */
export async function sendAnnTest(id: string, to: string): Promise<AnnState> {
  const admin = await requireAdmin();
  if (!rateLimit(`ann-test:${admin.id}`, 10, 10 * 60_000)) return { errors: ["Too many test emails. Please wait a few minutes."] };
  const email = String(to ?? "").trim();
  if (!isEmail(email)) return { errors: ["Write the email address to send the test to."] };
  const a = await getAnnouncement(id);
  if (!a) return { errors: ["Save the announcement first."] };
  const u = await pool.query('SELECT id FROM "user" WHERE lower(email) = lower($1)', [email]);
  try {
    const m = a.testEmail ? personalMessage(email, a.title, paragraphs(a.message)) : announcementEmail(a, { id: String(u.rows[0]?.id ?? admin.id), email });
    await sendMail({ ...m, subject: `[Test] ${m.subject}` });
  } catch (e) {
    return { errors: [(e as Error).message] };
  }
  return { ok: `Test sent to ${email}.` };
}
