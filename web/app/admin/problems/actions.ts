"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import { audit } from "@/lib/credits";
import { fdStr } from "@/lib/form";
import { ensureProblemColumns, VERSION_RE } from "@/lib/problems";
import type { ActionState } from "@/components/admin/ActionForm";

const KEY_RE = /^[0-9a-f]{32}$/;

/** "Fixed in 0.10.14": reports from that version or newer will show the problem as "Came back". */
export async function markProblemFixed(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const key = fdStr(fd, "key", 40);
  const version = fdStr(fd, "version", 20).trim().replace(/^v/i, "");
  if (!KEY_RE.test(key)) return { errors: ["Unknown problem."] };
  if (!VERSION_RE.test(version)) return { errors: ["Write the version that has the fix, like 0.10.14."] };
  if (!(await ensureProblemColumns())) return { errors: ["The database isn't ready. Try again in a minute."] };
  await pool.query(
    `INSERT INTO problem_fixes (problem_key, fixed_in, fixed_at, fixed_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (problem_key) DO UPDATE SET fixed_in = EXCLUDED.fixed_in, fixed_at = now(), fixed_by = EXCLUDED.fixed_by`,
    [key, version, admin.email],
  );
  await audit(admin.email, "problem.fixed", `problem:${key}`, { fixedIn: version });
  revalidatePath("/admin/problems");
  return { ok: `Marked fixed in ${version}.` };
}

/** Back to open (marked fixed by mistake). */
export async function reopenProblem(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const key = fdStr(fd, "key", 40);
  if (!KEY_RE.test(key)) return { errors: ["Unknown problem."] };
  await pool.query("DELETE FROM problem_fixes WHERE problem_key = $1", [key]);
  await audit(admin.email, "problem.reopen", `problem:${key}`);
  revalidatePath("/admin/problems");
  return { ok: "Open again." };
}
