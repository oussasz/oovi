"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "@/lib/session";
import { getPilotConfig, pilotOpenFor } from "@/lib/ai-config";
import { TEAM_SIZES } from "@/lib/team-sizes";
import { rateLimit } from "@/lib/api";
import { isBlocked } from "@/lib/credits";
import { pool } from "@/lib/db";
import { fdStr } from "@/lib/form";

export type PilotFormState = { ok?: boolean; errors?: string[] } | null;

/** One request per account. Eligibility is checked here again, never trusted from the page. */
export async function requestPilot(_prev: PilotFormState, fd: FormData): Promise<PilotFormState> {
  const session = await getServerSession();
  if (!session?.user) return { errors: ["Please log in again, then send your request."] };
  const userId = session.user.id;
  if (await isBlocked(userId)) return { errors: ["This account can’t take part in the pilot."] };
  if (!rateLimit(`pilot:${userId}`, 5, 10 * 60_000)) return { errors: ["Too many attempts. Please wait a few minutes and try again."] };

  const cfg = await getPilotConfig();
  const win = pilotOpenFor(cfg, session.user.createdAt);
  if (!win.open) return { errors: ["The pilot program isn’t accepting requests right now."] };
  if (!win.eligible) return { errors: ["The pilot is only for accounts created during the pilot period."] };

  const errors: string[] = [];
  const useCase = fdStr(fd, "useCase", 4000).trim();
  const organization = fdStr(fd, "organization", 400).trim();
  const role = fdStr(fd, "role", 400).trim();
  const teamSize = fdStr(fd, "teamSize", 20);
  if (useCase.length < 30) errors.push("Please tell us a bit more about what you’ll use oovi for (at least 30 characters).");
  if (useCase.length > 2000) errors.push("Please keep your description under 2,000 characters.");
  if (organization.length > 120) errors.push("Organization must be under 120 characters.");
  if (role.length > 120) errors.push("Role must be under 120 characters.");
  if (teamSize && !TEAM_SIZES.some((t) => t.value === teamSize)) errors.push("Pick a team size from the list.");
  if (fdStr(fd, "feedback", 10) !== "on") errors.push("Please confirm that you’ll send us feedback. It’s what the pilot is for.");
  if (errors.length) return { errors };

  try {
    const res = await pool.query(
      `INSERT INTO pilot_requests (user_id, use_case, organization, role, team_size)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''))
       ON CONFLICT (user_id) DO NOTHING RETURNING id`,
      [userId, useCase, organization, role, teamSize],
    );
    if (!res.rows[0]) return { errors: ["You’ve already sent a request. We’ll review it soon."] };
  } catch (err) {
    console.error("pilot request failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not send your request. Please try again."] };
  }
  revalidatePath("/pilot");
  revalidatePath("/account");
  return { ok: true };
}
