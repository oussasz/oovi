// Teach by showing: while the user works in a bot's browser (Live view, "Take control"), oovi can note each step
// (pages opened, what was clicked, what was typed where, keys like Enter) and turn them into a skill the user
// reviews before saving. Passwords are never kept: only "type the password". Pure: tests/unit/teach.test.mts.

/** What was under the pointer or in focus: its kind and the words a person would use for it. */
export type Target = { tag: string; type?: string; role?: string; label: string; secret?: boolean };
export type TeachStep =
  | { kind: "open"; url: string; title?: string }
  | { kind: "click"; target: Target }
  | { kind: "type"; target: Target; text: string }
  | { kind: "key"; key: string };

export const MAX_STEPS = 80;
const KEYS = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp"]);

/** A web address without what identifies a session or a person (tokens, ids in the query). */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    for (const k of [...u.searchParams.keys()]) if (/token|session|sid|auth|key|code|password|pwd|otp|email|state|nonce|sig/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

/** Adds a step: typing in the same field joins the previous typing, a repeated page or click isn't noted twice. */
export function addStep(steps: TeachStep[], s: TeachStep): TeachStep[] {
  if (steps.length >= MAX_STEPS) return steps;
  const last = steps.at(-1);
  if (s.kind === "open") {
    const url = cleanUrl(s.url);
    if (!url) return steps;
    const prevOpen = [...steps].reverse().find((x) => x.kind === "open") as Extract<TeachStep, { kind: "open" }> | undefined;
    if (prevOpen?.url === url) return steps;
    // A page that came from a click or Enter right before it is the result of that step, kept as a checkpoint.
    return [...steps, { kind: "open", url, ...(s.title ? { title: s.title.slice(0, 80) } : {}) }];
  }
  if (s.kind === "type") {
    const text = s.target.secret ? "" : s.text;
    if (last?.kind === "type" && sameTarget(last.target, s.target)) return [...steps.slice(0, -1), { ...last, text: last.text + text }];
    return [...steps, { kind: "type", target: s.target, text }];
  }
  if (s.kind === "key") {
    if (!KEYS.has(s.key)) return steps;
    return [...steps, s];
  }
  // A click into the field that typing then goes to is part of the typing: kept (it shows where), but not twice.
  if (last?.kind === "click" && sameTarget(last.target, s.target)) return steps;
  return [...steps, s];
}

const sameTarget = (a: Target, b: Target) => a.tag === b.tag && a.label === b.label && a.type === b.type;

const q = (s: string) => `“${s.replace(/\s+/g, " ").trim().slice(0, 60)}”`;

function what(t: Target): string {
  const name = t.label ? q(t.label) : "";
  if (t.tag === "a" || t.role === "link") return name ? `the link ${name}` : "the link";
  if (t.tag === "button" || t.role === "button" || t.type === "submit" || t.type === "button") return name ? `the ${name} button` : "the button";
  if (t.tag === "select" || t.role === "combobox" || t.role === "listbox") return name ? `the ${name} list` : "the list";
  if (t.type === "checkbox" || t.role === "checkbox") return name ? `the ${name} box` : "the box";
  if (t.type === "radio" || t.role === "radio") return name ? `the ${name} choice` : "the choice";
  if (t.tag === "input" || t.tag === "textarea" || t.role === "textbox" || t.role === "searchbox") return name ? `the ${name} field` : "the field";
  if (t.role === "option" || t.role === "menuitem" || t.role === "tab") return name ? `${name}` : "the item";
  return name || "that spot";
}

/** The steps as numbered sentences a person (and a bot) can follow. */
export function describeSteps(steps: TeachStep[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    if (s.kind === "open") out.push(i === 0 ? `Open ${s.url}` : `The page ${s.url} opens${s.title ? ` (${q(s.title)})` : ""}.`);
    else if (s.kind === "click") {
      // A click right before typing into the same field is said once, with the typing.
      if (next?.kind === "type" && sameTarget(next.target, s.target)) continue;
      out.push(`Click ${what(s.target)}.`);
    } else if (s.kind === "type") {
      if (s.target.secret) out.push(`Type the password in ${what(s.target)} (use fill_login with the saved login; never ask the user to type it in the chat).`);
      else if (s.text.trim()) out.push(`Type ${q(s.text)} in ${what(s.target)} (the user typed this as an example: use the value the task needs).`);
    } else if (s.kind === "key") out.push(s.key === "Enter" ? "Press Enter." : `Press ${s.key}.`);
  }
  return out.map((l, i) => `${i + 1}. ${l.replace(/\.\.$/, ".")}`);
}

/** The site the steps start on, for the skill's description. */
const siteOf = (steps: TeachStep[]) => {
  const o = steps.find((s) => s.kind === "open") as Extract<TeachStep, { kind: "open" }> | undefined;
  try {
    return o ? new URL(o.url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** A skill drafted from what the user showed: the user names it, reads it and can edit it before saving. */
export function skillFromSteps(steps: TeachStep[], name: string, goal = ""): { name: string; description: string; body: string } {
  const site = siteOf(steps);
  const lines = describeSteps(steps);
  const n = name.trim().slice(0, 60) || (site ? `Steps on ${site}` : "Steps shown by the user");
  return {
    name: n,
    description: (goal.trim() || `What the user showed, step by step${site ? `, on ${site}` : ""}`).slice(0, 200),
    body: [
      `The user showed how to do this in the bots' browser${site ? ` on ${site}` : ""}. Follow the same steps, in the same order, with browser tools (browser_steps can do several at once).`,
      goal.trim() ? `Goal: ${goal.trim()}` : "",
      "",
      ...lines,
      "",
      "If a page looks different from these steps (a new design, a pop-up, a sign-in), adapt: find the same button or field by its words. Stop and ask the user before anything the steps don't show that sends, pays, posts or deletes.",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n")
      .trim(),
  };
}
