"use server";

import { revalidatePath } from "next/cache";
import { userFor } from "@/lib/app-link-user";
import { useAppLink } from "@/lib/app-links";
import { getPilotConfig, pilotOpenFor } from "@/lib/ai-config";
import { TEAM_SIZES } from "@/lib/team-sizes";
import { rateLimit } from "@/lib/api";
import { isBlocked } from "@/lib/credits";
import { pool } from "@/lib/db";
import { fdStr } from "@/lib/form";
import { notify } from "@/lib/notify";
import { later } from "@/lib/user-signals";
import { FACES, HEARD, PAY_METHODS, ROLES, SYSTEMS, labelOf, labelsOf, parseAnswers, summaryLine } from "@/lib/pilot-form";
import { ensurePilotAnswers } from "@/lib/pilot-answers";

export type PilotFormState = { ok?: boolean; errors?: string[] } | null;

/** One request per account. Eligibility is checked here again, never trusted from the page. */
export async function requestPilot(_prev: PilotFormState, fd: FormData): Promise<PilotFormState> {
  // The website's session, or the app's single-use link (checked here, used once when the request is saved).
  const token = fdStr(fd, "t", 60) || undefined;
  const user = await userFor(token, "pilot");
  if (!user) return { errors: ["This link has expired. Open “Join the pilot” again from the oovi app."] };
  const session = { user };
  const userId = user.id;
  if (await isBlocked(userId)) return { errors: ["This account can’t take part in the pilot."] };
  if (!rateLimit(`pilot:${userId}`, 5, 10 * 60_000)) return { errors: ["Too many attempts. Please wait a few minutes and try again."] };

  const cfg = await getPilotConfig();
  const win = pilotOpenFor(cfg, session.user.createdAt);
  if (!win.open) return { errors: ["The pilot program isn’t accepting requests right now."] };
  if (!win.eligible) return { errors: ["The pilot is only for accounts created during the pilot period."] };

  // Every answer is a tap on a choice, a star or a face (lib/pilot-form.ts); only the company and one note are typed.
  const { errors, answers } = parseAnswers(fd);
  const organization = fdStr(fd, "organization", 400).trim();
  const teamSize = fdStr(fd, "teamSize", 20);
  if (organization.length > 120) errors.push("The company or project name must be under 120 characters.");
  if (teamSize && !TEAM_SIZES.some((t) => t.value === teamSize)) errors.push("Pick a team size from the list.");
  if (fdStr(fd, "feedback", 10) !== "on") errors.push("Please confirm that you’ll send us feedback. It’s what the pilot is for.");
  if (errors.length) return { errors };
  const useCase = summaryLine(answers);
  const roleLabel = labelOf(ROLES, answers.role);

  if (user.via === "link" && (await useAppLink(token, "pilot")) !== userId) return { errors: ["This link has expired. Open “Join the pilot” again from the oovi app."] };
  try {
    // The answers go in their own column; if it can't be created right now the request is still saved without them.
    const withAnswers = await ensurePilotAnswers();
    const res = withAnswers
      ? await pool.query(
          `INSERT INTO pilot_requests (user_id, use_case, organization, role, team_size, answers)
           VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), $6::jsonb)
           ON CONFLICT (user_id) DO NOTHING RETURNING id`,
          [userId, useCase, organization, roleLabel, teamSize, JSON.stringify(answers)],
        )
      : await pool.query(
          `INSERT INTO pilot_requests (user_id, use_case, organization, role, team_size)
           VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''))
           ON CONFLICT (user_id) DO NOTHING RETURNING id`,
          [userId, useCase, organization, roleLabel, teamSize],
        );
    if (!res.rows[0]) return { errors: ["You’ve already sent a request. We’ll review it soon."] };
  } catch (err) {
    console.error("pilot request failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not send your request. Please try again."] };
  }
  const who = session.user.email;
  const face = FACES.find((f) => f.value === answers.experience);
  later(() =>
    notify({
      event: "pilotRequest",
      title: `New pilot request from ${who}`,
      lead: "Someone asked to join the pilot. Review it and approve or reject.",
      rows: [
        ["Email", who],
        ["Who", roleLabel],
        ["Computer", labelOf(SYSTEMS, answers.system)],
        ["Heard about oovi", answers.heard === "other" && answers.heardOther ? answers.heardOther : labelOf(HEARD, answers.heard)],
        ["First try", face ? `${face.icon} ${face.label}` : "–"],
        ["Can pay with", labelsOf(PAY_METHODS, answers.payMethods)],
        ["Company", organization || "–"],
      ],
      quote: useCase,
      button: { label: "Review the request", path: "/admin/pilot" },
    }),
  );
  revalidatePath("/pilot");
  return { ok: true };
}
