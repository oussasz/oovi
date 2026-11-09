"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import {
  EFFORTS,
  getAiConfig,
  getPilotConfig,
  getPlans,
  saveAiConfig,
  savePilotConfig,
  savePlans,
  saveProviderKey,
  type AiConfig,
  type Effort,
  type PilotConfig,
  type Plan,
} from "@/lib/ai-config";
import { audit } from "@/lib/credits";
import { fdBool, fdNum, fdStr } from "@/lib/form";
import type { ActionState } from "@/components/admin/ActionForm";

const MODEL_RE = /^[A-Za-z0-9._:@/-]{1,100}$/;
const PLAN_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  revalidatePath("/admin/ai");
  revalidatePath("/admin");
  revalidatePath("/pricing");
  revalidatePath("/pilot");
}

/** Only the fields that changed, for the audit log. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}

// ---------- emergency pause ----------

export async function setPaused(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const paused = fdStr(fd, "paused", 10) === "true";
  const cfg = await getAiConfig();
  if (cfg.paused !== paused) {
    await saveAiConfig({ ...cfg, paused }, admin.email);
    await audit(admin.email, paused ? "ai.pause" : "ai.resume", "ai", { paused });
  }
  refresh();
}

// ---------- settings ----------

export async function saveAiSettings(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const errors: string[] = [];
  const before = await getAiConfig();

  const displayName = fdStr(fd, "displayName", 100).trim();
  if (!displayName || displayName.length > 40) errors.push("Display name must be 1 to 40 characters.");
  const model = fdStr(fd, "model", 200).trim();
  if (!MODEL_RE.test(model)) errors.push("Model ID must be 1 to 100 characters: letters, numbers, dots, dashes, colons or slashes.");
  const backupModel = fdStr(fd, "backupModel", 200).trim();
  if (backupModel && !MODEL_RE.test(backupModel)) errors.push("Backup model ID has invalid characters. Leave it empty for none.");
  if (backupModel && backupModel === model) errors.push("The backup model must be different from the main model (or empty).");
  const pausedMessage = fdStr(fd, "pausedMessage", 1000).trim();
  if (pausedMessage.length < 10 || pausedMessage.length > 500) errors.push("Paused message must be 10 to 500 characters.");
  const subscribeUrl = fdStr(fd, "subscribeUrl", 600).trim();
  if (subscribeUrl) {
    let ok = false;
    try {
      ok = new URL(subscribeUrl).protocol === "https:" && subscribeUrl.length <= 500;
    } catch {
      ok = false;
    }
    if (!ok) errors.push("Subscribe link must be a full https:// address (or empty).");
  }
  const effort = fdStr(fd, "maxEffort", 20);
  if (!(EFFORTS as readonly string[]).includes(effort)) errors.push("Pick a maximum effort.");

  const price = (key: string, label: string) => fdNum(fd, key, label, errors, { min: 0, max: 1000 });
  const prices = {
    input: price("price_input", "Input price"),
    output: price("price_output", "Output price"),
    cacheRead: price("price_cacheRead", "Cache read price"),
    cacheWrite: price("price_cacheWrite", "Cache write price"),
    longAbove: fdNum(fd, "price_longAbove", "Long-context threshold", errors, { min: 0, max: 10_000_000, integer: true }),
    longInput: price("price_longInput", "Long-context input price"),
    longOutput: price("price_longOutput", "Long-context output price"),
  };
  const creditsPerUsd = fdNum(fd, "creditsPerUsd", "Credits per US dollar", errors, { min: 1, max: 1_000_000 });
  const maxInputTokens = fdNum(fd, "maxInputTokens", "Maximum input tokens", errors, { min: 4_000, max: 1_000_000, integer: true });
  const maxOutputTokens = fdNum(fd, "maxOutputTokens", "Maximum output tokens", errors, { min: 256, max: 128_000, integer: true });
  const maxConcurrent = fdNum(fd, "maxConcurrent", "Calls at the same time", errors, { min: 1, max: 50, integer: true });
  const dailyBudgetUsd = fdNum(fd, "dailyBudgetUsd", "Daily budget", errors, { min: 0, max: 1_000_000 });
  const signupCredits = fdNum(fd, "signupCredits", "Welcome credits", errors, { min: 0, max: 10_000_000, integer: true });
  const signupGrantsPerNetwork = fdNum(fd, "signupGrantsPerNetwork", "Welcome grants per network", errors, {
    min: 0,
    max: 10_000,
    integer: true,
  });
  if (errors.length) return { errors };

  const next: AiConfig = {
    enabled: fdBool(fd, "enabled"),
    // Pausing has its own button at the top of the page, so a stale form can't undo it.
    paused: before.paused,
    pausedMessage,
    displayName,
    model,
    backupModel,
    prices: prices as AiConfig["prices"],
    creditsPerUsd: creditsPerUsd!,
    maxInputTokens: maxInputTokens!,
    maxOutputTokens: maxOutputTokens!,
    maxEffort: effort as Effort,
    maxConcurrent: maxConcurrent!,
    dailyBudgetUsd: dailyBudgetUsd!,
    signupCredits: signupCredits!,
    signupGrantsPerNetwork: signupGrantsPerNetwork!,
    subscribeUrl,
  };
  try {
    await saveAiConfig(next, admin.email);
    const changes = diff(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    if (Object.keys(changes).length) await audit(admin.email, "ai.settings", "ai", changes);
  } catch (err) {
    console.error("ai settings save failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not save. Please try again."] };
  }
  refresh();
  return { ok: "Settings saved. They apply to new calls within about 15 seconds." };
}

// ---------- provider key ----------

export async function replaceProviderKey(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const key = fdStr(fd, "key", 400).trim();
  if (!key) return { errors: ["Paste the new key first."] };
  if (!key.startsWith("sk-ant-") || key.length < 30 || key.length > 300 || /\s/.test(key)) {
    return { errors: ["That doesn't look like an Anthropic API key. It should start with “sk-ant-” and have no spaces."] };
  }
  try {
    await saveProviderKey(key, admin.email);
    await audit(admin.email, "ai.key.replace", "ai", { last4: key.slice(-4) });
  } catch (err) {
    // Never log the key itself: only the reason.
    console.error("provider key save failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Could not save the key. Check that AI_KEY_SECRET (or BETTER_AUTH_SECRET) is set on the server."] };
  }
  revalidatePath("/admin/ai");
  return { ok: "Key saved. New calls use it within about 15 seconds." };
}

export async function removeProviderKey(): Promise<ActionState> {
  const admin = await requireAdmin();
  try {
    await saveProviderKey(null, admin.email);
    await audit(admin.email, "ai.key.remove", "ai", null);
  } catch (err) {
    console.error("provider key remove failed", err instanceof Error ? err.message : "unknown error");
    return { errors: ["Could not remove the key. Please try again."] };
  }
  revalidatePath("/admin/ai");
  return { ok: "Key removed from the console." };
}

// ---------- plans ----------

export async function savePlansAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  let raw: unknown;
  try {
    raw = JSON.parse(fdStr(fd, "plans", 50_000));
  } catch {
    return { errors: ["Could not read the plans. Reload the page and try again."] };
  }
  if (!Array.isArray(raw)) return { errors: ["Could not read the plans. Reload the page and try again."] };
  if (raw.length > 20) return { errors: ["You can have at most 20 plans."] };

  const errors: string[] = [];
  const plans: Plan[] = [];
  raw.forEach((x, i) => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const row = `Row ${i + 1}`;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const price = typeof r.price === "string" ? r.price.trim() : "";
    const monthly = Number(String(r.monthlyCredits ?? "").replace(/,/g, ""));
    const daily = Number(String(r.dailyLimit ?? "").replace(/,/g, ""));
    if (!PLAN_ID_RE.test(id)) errors.push(`${row}: ID must start with a letter and use only lowercase letters, numbers and dashes (max 32).`);
    else if (plans.some((p) => p.id === id)) errors.push(`${row}: the ID “${id}” is used twice.`);
    if (!name || name.length > 40) errors.push(`${row}: name must be 1 to 40 characters.`);
    if (price.length > 40) errors.push(`${row}: price label must be at most 40 characters.`);
    if (!Number.isInteger(monthly) || monthly < 0 || monthly > 100_000_000) errors.push(`${row}: monthly credits must be a whole number from 0 to 100,000,000.`);
    if (!Number.isInteger(daily) || daily < 0 || daily > 100_000_000) errors.push(`${row}: daily limit must be a whole number from 0 to 100,000,000.`);
    plans.push({ id, name, price, monthlyCredits: monthly, dailyLimit: daily, visible: r.visible === true });
  });
  if (!plans.some((p) => p.id === "free")) errors.push("The “free” plan can't be removed: it's what everyone falls back to.");
  if (errors.length) return { errors };

  const before = await getPlans();
  const removed = before.filter((b) => !plans.some((p) => p.id === b.id)).map((b) => b.id);
  const pilot = await getPilotConfig();
  if (removed.includes(pilot.plan)) {
    return { errors: [`The pilot program gives the “${pilot.plan}” plan. Choose another plan in Pilot settings before removing it.`] };
  }
  if (removed.length) {
    const { rows } = await pool.query<{ plan: string; c: string }>(
      `SELECT plan, count(*) AS c FROM credit_accounts WHERE plan = ANY($1::text[]) GROUP BY plan`,
      [removed],
    );
    for (const r of rows) {
      errors.push(`${Number(r.c).toLocaleString("en-US")} people are on the “${r.plan}” plan. Move them to another plan before removing it.`);
    }
    if (errors.length) return { errors };
  }

  try {
    await savePlans(plans, admin.email);
    await audit(admin.email, "plans.save", "plans", { before, after: plans });
  } catch (err) {
    console.error("plans save failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not save. Please try again."] };
  }
  refresh();
  return { ok: "Plans saved." };
}

// ---------- pilot ----------

export async function savePilotSettings(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const errors: string[] = [];
  const startsAt = fdStr(fd, "startsAt", 20);
  const endsAt = fdStr(fd, "endsAt", 20);
  const valid = (d: string) => DATE_RE.test(d) && !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
  if (!valid(startsAt)) errors.push("Start date is required (YYYY-MM-DD).");
  if (!valid(endsAt)) errors.push("End date is required (YYYY-MM-DD).");
  if (valid(startsAt) && valid(endsAt) && endsAt < startsAt) errors.push("The end date must be on or after the start date.");
  const credits = fdNum(fd, "credits", "Credits per approved request", errors, { min: 0, max: 10_000_000, integer: true });
  const days = fdNum(fd, "days", "Plan length", errors, { min: 1, max: 3650, integer: true });
  const plan = fdStr(fd, "plan", 40);
  const plans = await getPlans();
  if (!plans.some((p) => p.id === plan)) errors.push("Pick a plan that exists.");
  if (errors.length) return { errors };

  const before = await getPilotConfig();
  const next: PilotConfig = { enabled: fdBool(fd, "enabled"), public: fdBool(fd, "public"), startsAt, endsAt, credits: credits!, plan, days: days! };
  try {
    await savePilotConfig(next, admin.email);
    const changes = diff(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>);
    if (Object.keys(changes).length) await audit(admin.email, "pilot.settings", "pilot", changes);
  } catch (err) {
    console.error("pilot settings save failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not save. Please try again."] };
  }
  refresh();
  return { ok: "Pilot settings saved." };
}
