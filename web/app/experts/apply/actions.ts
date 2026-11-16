"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/api";
import { later } from "@/lib/user-signals";
import { notify } from "@/lib/notify";
import { requestIp } from "@/lib/request-ip";
import { applicationsToday, ensureExpertTable, saveApplication } from "@/lib/expert-db";
import { CONSENT_VERSION, consentHash, ipHash, parseExpertForm } from "@/lib/expert-form";

export type ExpertFormState = { ok?: boolean; errors?: string[] } | null;

const DAILY_CAP = 200;

/** Anyone can send a request (no account needed). Everything is checked here again; nothing from the browser is trusted. */
export async function applyAsExpert(_prev: ExpertFormState, fd: FormData): Promise<ExpertFormState> {
  const parsed = parseExpertForm((k) => (k === "languages" ? (fd.getAll(k).filter((x) => typeof x === "string") as string[]) : (fd.get(k) as string | null)));
  // A script filled the hidden field: pretend it worked, save nothing.
  if (parsed.honeypot) return { ok: true };

  const ip = await requestIp();
  const hash = ipHash(ip);
  if (!rateLimit(`expert:${hash ?? "unknown"}`, 5, 10 * 60_000) || !rateLimit("expert:all", 60, 10 * 60_000)) {
    return { errors: ["Too many attempts. Please wait a few minutes and try again."] };
  }
  if (!parsed.value) return { errors: parsed.errors };
  const v = parsed.value;

  if (!(await ensureExpertTable())) return { errors: ["We can’t take requests right now. Please try again in a few minutes."] };
  try {
    if ((await applicationsToday()) >= DAILY_CAP) return { errors: ["We’ve had a lot of requests today. Please try again tomorrow."] };
    const h = await headers();
    const saved = await saveApplication(v, {
      consentVersion: CONSENT_VERSION,
      consentHash: consentHash(),
      ipHash: hash,
      userAgent: h.get("user-agent") ?? "",
    });
    if (saved === "new") {
      later(() =>
        notify({
          event: "expertApplication",
          title: `New expert application from ${v.name}`,
          lead: "Someone asked to be added as an expert on oovi. Read it, then accept or decline.",
          rows: [
            ["Name", v.name],
            ["Email", v.email],
            ["Expert in", v.field],
            ["Profile", v.profileUrl],
            ["Signature", v.typedOnly ? "Typed name only" : "Drawn and typed"],
          ],
          quote: v.bio,
          button: { label: "Review the application", path: "/admin/experts" },
        }),
      );
    }
  } catch (err) {
    console.error("expert application failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not send your request. Please try again."] };
  }
  return { ok: true };
}
