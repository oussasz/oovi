// Replaying a skill the user recorded (teach by showing, lib/teach-core.ts) in the bot's browser by code: no
// model call per step. Each element is found the way a person finds it: by its role and its words, or the
// label of a field. The first step that can't be found stops the replay; the bot then carries on from there
// with the page in front of it.
import type { Page } from "playwright-core";
import type { Target, TeachStep } from "./teach-core";
import { cleanUrl } from "./teach-core";

export type ReplayResult = { done: string[]; stoppedAt?: { index: number; why: string } };

const ROLE_OF = (t: Target): "link" | "button" | "checkbox" | "radio" | "combobox" | "textbox" | null => {
  if (t.role === "link" || t.tag === "a") return "link";
  if (t.role === "button" || t.tag === "button" || t.type === "submit" || t.type === "button") return "button";
  if (t.type === "checkbox" || t.role === "checkbox") return "checkbox";
  if (t.type === "radio" || t.role === "radio") return "radio";
  if (t.tag === "select" || t.role === "combobox") return "combobox";
  if (t.tag === "input" || t.tag === "textarea" || t.role === "textbox" || t.role === "searchbox") return "textbox";
  return null;
};

/** The element a recorded step names, on today's page; null when it isn't there. */
async function find(page: Page, t: Target) {
  const label = t.label.trim();
  if (!label) return null;
  const role = ROLE_OF(t);
  const tries = [
    ...(role ? [page.getByRole(role, { name: label, exact: true }), page.getByRole(role, { name: label })] : []),
    ...(role === "textbox" || role === "combobox" ? [page.getByLabel(label, { exact: true }), page.getByPlaceholder(label, { exact: true })] : []),
    page.getByText(label, { exact: true }),
  ];
  for (const l of tries) {
    const first = l.first();
    if ((await first.count().catch(() => 0)) > 0 && (await first.isVisible().catch(() => false))) return first;
  }
  return null;
}

const settle = (page: Page) => page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => {});

/**
 * values: what to type instead of the recorded example, by field name ("Email": "karim@x.dz").
 * Passwords are never replayed (the step stops: sign in with fill_login).
 */
export async function replay(page: Page, steps: TeachStep[], values: Record<string, string> = {}, signal?: AbortSignal): Promise<ReplayResult> {
  const done: string[] = [];
  const valueFor = (label: string) => {
    const k = Object.keys(values).find((x) => x.trim().toLowerCase() === label.trim().toLowerCase());
    return k !== undefined ? String(values[k]) : undefined;
  };
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) return { done, stoppedAt: { index: i, why: "stopped" } };
    const s = steps[i]!;
    try {
      if (s.kind === "open") {
        const url = cleanUrl(s.url);
        if (!url) continue;
        if (i === 0) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          done.push(`opened ${url}`);
        } else {
          // A page the recording reached by itself: wait for it, and check it is the same place.
          await settle(page);
          const want = new URL(url);
          const now = new URL(page.url());
          if (now.host !== want.host) return { done, stoppedAt: { index: i, why: `expected to be on ${want.host}, but the page is ${now.host}` } };
        }
      } else if (s.kind === "click") {
        const el = await find(page, s.target);
        if (!el) return { done, stoppedAt: { index: i, why: `couldn't find "${s.target.label}" on the page` } };
        await el.click({ timeout: 10_000 });
        await settle(page);
        done.push(`clicked "${s.target.label}"`);
      } else if (s.kind === "type") {
        if (s.target.secret) return { done, stoppedAt: { index: i, why: `"${s.target.label}" is a password or code field: sign in with fill_login, then call replay_skill again or continue` } };
        const el = await find(page, s.target);
        if (!el) return { done, stoppedAt: { index: i, why: `couldn't find the field "${s.target.label}"` } };
        const text = valueFor(s.target.label) ?? s.text;
        if ((await el.evaluate((e) => e.tagName).catch(() => "")) === "SELECT") await el.selectOption({ label: text }, { timeout: 10_000 });
        else await el.fill(text, { timeout: 10_000 });
        done.push(`typed "${text.slice(0, 60)}" in "${s.target.label}"`);
      } else if (s.kind === "key") {
        await page.keyboard.press(s.key);
        await settle(page);
        done.push(`pressed ${s.key}`);
      }
    } catch (e) {
      return { done, stoppedAt: { index: i, why: (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200) } };
    }
  }
  return { done };
}

/** Recorded steps kept with a skill: only the shapes oovi writes (a damaged file replays nothing). */
export function cleanSteps(raw: unknown): TeachStep[] {
  if (!Array.isArray(raw)) return [];
  const out: TeachStep[] = [];
  for (const x of raw.slice(0, 80)) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const tg = (v: unknown): Target | null => {
      const t = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
      if (!t || typeof t.tag !== "string" || typeof t.label !== "string") return null;
      return { tag: t.tag.slice(0, 20), label: t.label.slice(0, 120), ...(typeof t.type === "string" ? { type: t.type.slice(0, 20) } : {}), ...(typeof t.role === "string" ? { role: t.role.slice(0, 20) } : {}), ...(t.secret === true ? { secret: true } : {}) };
    };
    if (o.kind === "open" && typeof o.url === "string" && cleanUrl(o.url)) out.push({ kind: "open", url: cleanUrl(o.url) });
    else if (o.kind === "click" && tg(o.target)) out.push({ kind: "click", target: tg(o.target)! });
    else if (o.kind === "type" && tg(o.target)) out.push({ kind: "type", target: tg(o.target)!, text: tg(o.target)!.secret ? "" : String(o.text ?? "").slice(0, 2000) });
    else if (o.kind === "key" && typeof o.key === "string" && /^[A-Za-z]{1,12}$/.test(o.key)) out.push({ kind: "key", key: o.key });
  }
  return out;
}
