// First run, made personal: the user picks their leader's character, tells it what they'll use oovi for, and
// gets a team suggested from those answers (ready-made experts and teams from the Marketplace).
// Pure: tests/unit/onboarding.test.mts.
import type { Face } from "./faces";

/** The leader's characters. The face and the name are a start: the user can rename and reshuffle. */
export const LEADERS = [
  { id: "calm", name: "Oovi", face: { color: 8, shape: 0, hair: 0, eyes: 0, nose: 0, mouth: 1, cheeks: 1, top: 0, wear: 0 }, personality: "calm and organized: you keep things simple, structured and clear" },
  { id: "warm", name: "Lina", face: { color: 5, shape: 2, hair: 6, eyes: 1, nose: 0, mouth: 0, cheeks: 3, top: 6, wear: 0 }, personality: "warm and encouraging: kind, positive and patient, you celebrate progress" },
  { id: "direct", name: "Rex", face: { color: 0, shape: 4, hair: 2, eyes: 4, nose: 1, mouth: 2, cheeks: 0, top: 7, wear: 2 }, personality: "fast and to the point: short answers, no small talk, straight to the result" },
  { id: "funny", name: "Momo", face: { color: 1, shape: 1, hair: 5, eyes: 2, nose: 0, mouth: 1, cheeks: 1, top: 8, wear: 0 }, personality: "funny and playful: a light, friendly tone with a touch of humor, while doing serious work well" },
  { id: "thoughtful", name: "Sage", face: { color: 7, shape: 3, hair: 4, eyes: 3, nose: 2, mouth: 3, cheeks: 2, top: 0, wear: 1 }, personality: "thoughtful and detailed: you explain your reasoning, weigh the options and point out what matters" },
] as const satisfies readonly { id: string; name: string; face: Face; personality: string }[];
export type LeaderStyle = (typeof LEADERS)[number]["id"];

/** What the user will use oovi for, and the Marketplace setups that fit each, best first. "starter": the classic trio. */
export const GOALS = [
  { id: "marketing", words: "marketing social media posts brand ads content", setups: ["marketing-agency", "social-manager", "copywriter", "seo-expert", "ads-manager"] },
  { id: "clients", words: "clients customers prospects sales leads outreach phone list", setups: ["research-desk", "email-marketer", "support-desk"] },
  { id: "business", words: "business startup idea plan finance pitch", setups: ["startup-studio", "abdelaziz-benkirat", "business-planner", "financial-analyst"] },
  { id: "shop", words: "shop store ecommerce products orders", setups: ["shop-team", "social-manager", "support-desk"] },
  { id: "study", words: "study school university exam learn course", setups: ["study-group", "tutor", "translator"] },
  { id: "research", words: "research report analysis data sources", setups: ["research-desk", "data-analyst"] },
  { id: "writing", words: "writing articles translation documents blog", setups: ["content-studio", "copywriter", "translator"] },
  { id: "code", words: "website code app developer software", setups: ["web-agency", "coding-team", "product-manager"] },
  { id: "people", words: "hiring recruiting contracts legal hr", setups: ["recruiter", "legal-helper"] },
  { id: "everyday", words: "personal assistant emails tasks everyday", setups: ["starter"] },
] as const;
export type GoalId = (typeof GOALS)[number]["id"];
export const isGoal = (x: unknown): x is GoalId => GOALS.some((g) => g.id === x);

/** The classic three, offered as one choice (no longer given to everyone). */
export const STARTER = {
  id: "starter",
  name: "Starter team",
  description: "A researcher, a writer and a critic who work together on anything you ask.",
  bots: [
    { name: "Scout", role: "Researcher", face: { color: 0, shape: 0, hair: 1, eyes: 0, nose: 1, mouth: 0, cheeks: 1, top: 0, wear: 1 } },
    { name: "Quill", role: "Writer", face: { color: 1, shape: 2, hair: 3, eyes: 1, nose: 0, mouth: 1, cheeks: 1, top: 2, wear: 0 } },
    { name: "Nova", role: "Critic", face: { color: 2, shape: 1, hair: 2, eyes: 2, nose: 2, mouth: 3, cheeks: 2, top: 0, wear: 0 } },
  ],
};

export type SetupLike = { id: string; name: string; description: string };
const words = (s: string) => new Set((s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]{3,}/gu) ?? []));

/**
 * The setups to suggest for these goals (at most `max`), best first, and the ones ticked from the start (`pick`).
 * Each goal gives its setups points by rank (the first fits best); setups several goals share rise; a few words
 * typed under "Something else" add the setups whose name or description mention them. Setups the Marketplace
 * doesn't have (hidden by the admin) are left out.
 */
export function suggestSetups(goals: readonly string[], other: string, available: readonly SetupLike[], max = 4, pick = 2): { ids: string[]; picked: string[] } {
  const have = new Set([...available.map((s) => s.id), STARTER.id]);
  const score = new Map<string, number>();
  const add = (id: string, n: number) => have.has(id) && score.set(id, (score.get(id) ?? 0) + n);
  // A setup scores by its best fit (5 for a goal's first choice, then 4, 3…), plus 1 for each other chosen goal it
  // also fits: what fits one goal best stays ahead of what fits two goals a little.
  const best = new Map<string, { top: number; n: number }>();
  for (const g of GOALS) if (goals.includes(g.id)) g.setups.forEach((id, i) => {
    const b = best.get(id) ?? { top: 0, n: 0 };
    best.set(id, { top: Math.max(b.top, 5 - Math.min(i, 4)), n: b.n + 1 });
  });
  for (const [id, b] of best) add(id, b.top + (b.n - 1));
  const typed = words(other);
  if (typed.size) {
    for (const s of available) {
      const w = words(`${s.name} ${s.description}`);
      const hits = [...typed].filter((x) => w.has(x)).length;
      if (hits) add(s.id, 2 * hits);
    }
    for (const g of GOALS) if ([...words(g.words)].some((x) => typed.has(x))) g.setups.forEach((id, i) => add(id, 3 - Math.min(i, 2)));
  }
  let ids = [...score.entries()].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0])).map(([id]) => id).slice(0, max);
  // Nothing chosen, or nothing fits: the all-round team first, then two common helpers.
  if (!ids.length) ids = [STARTER.id, "research-desk", "content-studio"].filter((id) => have.has(id));
  return { ids, picked: ids.slice(0, ids.length && !score.size ? 1 : pick) };
}
const ALL_ORDER: string[] = GOALS.flatMap((g) => [...g.setups]);
const order = (id: string) => {
  const i = ALL_ORDER.indexOf(id);
  return i < 0 ? 999 : i;
};

/** The lines added to the leader's instructions: its character and what the user wants help with. */
export function leaderNotes(style: LeaderStyle | null, goals: readonly string[], other: string): string {
  const l = LEADERS.find((x) => x.id === style);
  const labels: Record<GoalId, string> = {
    marketing: "marketing and social media",
    clients: "finding clients and sales",
    business: "starting or growing a business",
    shop: "an online shop",
    study: "studying and learning",
    research: "research and reports",
    writing: "writing and translation",
    code: "websites and code",
    people: "hiring and contracts",
    everyday: "everyday tasks and personal help",
  };
  const g = goals.filter(isGoal).map((x) => labels[x]);
  const extra = other.replace(/\s+/g, " ").trim().slice(0, 200);
  return [
    l ? `Your personality: ${l.personality}.` : "",
    g.length || extra ? `The user told you, when they started, that they will mainly use oovi for: ${[...g, ...(extra ? [`"${extra}"`] : [])].join(", ")}. Keep that in mind, and suggest the teammates and groups that fit.` : "",
  ].filter(Boolean).join("\n");
}
