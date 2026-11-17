// Spending limits: what bots spent today and this month (own keys in dollars, theOovi in credits), and
// whether a limit is reached. Pure: tests/unit/spend.test.mts. The ledger file and the checks before each
// model call are in lib/spend.ts.

export type Spent = { usd: number; credits: number };
export type Ledger = { days: Record<string, Spent> };
export type Limits = { dayUsd?: number; monthUsd?: number; dayCredits?: number; monthCredits?: number };

/** Days kept: this month and the one before. */
export const KEEP_DAYS = 62;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function addSpend(l: Ledger, day: string, usd: number, credits: number): Ledger {
  const days = { ...l.days };
  const cur = days[day] ?? { usd: 0, credits: 0 };
  days[day] = { usd: Math.round((cur.usd + Math.max(0, usd || 0)) * 1e6) / 1e6, credits: Math.round((cur.credits + Math.max(0, credits || 0)) * 100) / 100 };
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  return { days: Object.fromEntries(keep.map((k) => [k, days[k]!])) };
}

export function totals(l: Ledger, now: Date): { day: Spent; month: Spent } {
  const today = dayKey(now);
  const month = today.slice(0, 7);
  const m: Spent = { usd: 0, credits: 0 };
  for (const [k, v] of Object.entries(l.days)) {
    if (!k.startsWith(month)) continue;
    m.usd += v.usd;
    m.credits += v.credits;
  }
  return { day: l.days[today] ?? { usd: 0, credits: 0 }, month: m };
}

export type Reached = { which: "dayUsd" | "monthUsd" | "dayCredits" | "monthCredits"; limit: number; spent: number } | null;

/** The first limit reached, or null. */
export function limitReached(l: Ledger, limits: Limits | undefined, now: Date): Reached {
  if (!limits) return null;
  const t = totals(l, now);
  const checks: [NonNullable<Reached>["which"], number | undefined, number][] = [
    ["dayUsd", limits.dayUsd, t.day.usd],
    ["monthUsd", limits.monthUsd, t.month.usd],
    ["dayCredits", limits.dayCredits, t.day.credits],
    ["monthCredits", limits.monthCredits, t.month.credits],
  ];
  for (const [which, limit, spent] of checks) if (typeof limit === "number" && limit > 0 && spent >= limit) return { which, limit, spent };
  return null;
}

/**
 * A routine run that costs far more than usual stops itself: past `factor` times the median of its
 * last runs (at least 3 known). Its unit is credits when it ran on theOovi, else dollars.
 */
export function runCap(history: Spent[], factor = 3): Spent | null {
  if (history.length < 3) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const credits = med(history.map((h) => h.credits));
  const usd = med(history.map((h) => h.usd));
  if (credits <= 0 && usd <= 0) return null;
  return { credits: credits * factor, usd: usd * factor };
}

export const overCap = (spent: Spent, cap: Spent | null) => !!cap && ((cap.credits > 0 && spent.credits > cap.credits) || (cap.usd > 0 && spent.usd > cap.usd));
