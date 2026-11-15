"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/api";
import { audit } from "@/lib/credits";
import { sendMail, smtpStatus } from "@/lib/mail";
import { updateAsk } from "@/lib/mail-templates";
import { latestVersion, peopleBehind } from "@/lib/update-ask";
import type { ActionState } from "@/components/admin/ActionForm";

/** Most emails one press sends (the rest go with the next press; nobody gets two for the same version). */
const PER_RUN = 150;

/** Emails everyone on an older app than the latest release, once per version. */
export async function sendUpdateAsk(): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!rateLimit(`update-ask:${admin.id}`, 3, 10 * 60_000)) return { errors: ["You just sent these. Please wait a few minutes."] };
  const mail = await smtpStatus().catch(() => null);
  if (mail && !mail.ready) return { errors: ["Email isn't set up yet: add the mail server in Admin > Email first."] };
  const latest = await latestVersion();
  if (!latest) return { errors: ["Couldn't read the latest version. Try again in a minute."] };
  const people = (await peopleBehind(latest)).slice(0, PER_RUN);
  if (!people.length) return { ok: `Everyone is on ${latest} already, or has been asked.` };
  let sent = 0;
  const failed: string[] = [];
  for (const p of people) {
    try {
      await sendMail(updateAsk(p.email, p.name ?? "", p.version, latest, p.platform));
      sent++;
      await audit(admin.email, "update.ask", p.email.toLowerCase(), { version: latest, from: p.version }).catch(() => {});
    } catch {
      failed.push(p.email);
    }
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
  return failed.length
    ? { errors: [`Sent to ${sent}. Couldn't send to ${failed.length}: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}. Press again to retry them.`] }
    : { ok: `Sent to ${sent} ${sent === 1 ? "person" : "people"}. They'll get it within a minute.` };
}
