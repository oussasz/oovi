"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { audit } from "@/lib/credits";
import { getFinanceSettings, saveFinanceSettings, type FinanceSettings } from "@/lib/finance";
import { fdNum, fdStr } from "@/lib/form";
import type { ActionState } from "@/components/admin/ActionForm";

/** Cash in the bank and fixed monthly costs, for burn rate and runway. */
export async function saveFinanceAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const errors: string[] = [];
  const cash = fdNum(fd, "cashUsd", "Cash in the bank", errors, { min: 0, max: 1e10, optional: true });
  const asOf = fdStr(fd, "cashAsOf", 10).trim();
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) errors.push("The cash date must be a date.");

  let raw: unknown;
  try {
    raw = JSON.parse(fdStr(fd, "costs", 20_000) || "[]");
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return { errors: ["Could not read the costs. Reload the page and try again."] };
  const costs: FinanceSettings["costs"] = [];
  raw.slice(0, 30).forEach((x, i) => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    const amount = String(r.usd ?? "").trim().replace(/,/g, "");
    if (!name && !amount) return; // empty row
    const usd = Number(amount);
    if (!name || name.length > 60) errors.push(`Cost ${i + 1}: name must be 1 to 60 characters.`);
    if (!Number.isFinite(usd) || usd < 0 || usd > 10_000_000) errors.push(`Cost ${i + 1}: amount must be a number from 0 to 10,000,000.`);
    costs.push({ name, usd });
  });
  if (errors.length) return { errors };

  const before = await getFinanceSettings();
  const next: FinanceSettings = { cashUsd: cash ?? 0, cashAsOf: asOf || null, costs };
  try {
    await saveFinanceSettings(next, admin.email);
    await audit(admin.email, "finance.save", "finance", { before, after: next });
  } catch (err) {
    console.error("finance save failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not save. Please try again."] };
  }
  revalidatePath("/admin/finance");
  return { ok: "Saved." };
}
