// theOovi status on this computer: credits, today's limit and the account's links.
// Fetched from the oovi account service and refreshed after every theOovi call, so the
// credits shown in the app match the server. Kept in memory only.
import { CloudError, cloud, sessionToken } from "./account";
import { HOSTED_NAME } from "./providers-meta";

export type HostedState = "ok" | "verify_email" | "no_credits" | "daily_limit" | "suspended" | "paused" | "off" | "blocked" | "offline";

export type HostedStatus = {
  state: HostedState;
  message: string | null;
  displayName: string;
  balance: number;
  dailyLimit: number;
  dailyUsed: number;
  resetsAt: string;
  plan: { id: string; name: string };
  planUntil: string | null;
  maxInputTokens: number;
  /** How many calls the server lets this account run at once. Missing from older servers: 3 (the server's default). */
  maxConcurrent?: number;
  links: { subscribe: string; pricing: string; pilot: string; feedback: string };
  pilot: { open: boolean; eligible: boolean; public?: boolean; status: "pending" | "approved" | "rejected" | null; credits: number };
  /** theOovi's model can control the desktop (Claude's computer toolset). Missing from older servers: treated as yes. */
  desktop?: boolean;
  /** When the server last confirmed these numbers (ms). */
  checkedAt: number;
};

export type HostedLive = { balance: number; dailyUsed: number; dailyLimit: number; resetsAt: string };

const g = globalThis as typeof globalThis & { __ooviHosted?: HostedStatus | null; __ooviHostedAt?: number };
const FRESH_MS = 60_000;
export const DEFAULT_MAX_INPUT = 100_000;

function stateFrom(s: HostedStatus): HostedState {
  if (s.state !== "ok" && s.state !== "no_credits" && s.state !== "daily_limit" && s.state !== "offline") return s.state;
  if (s.balance <= 0) return "no_credits";
  if (s.dailyLimit > 0 && s.dailyUsed >= s.dailyLimit) return "daily_limit";
  return "ok";
}

const nextMidnight = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};

/** The last known status (may be a minute old). null = signed out or never loaded. */
export const cachedHosted = (): HostedStatus | null => g.__ooviHosted ?? null;

/** Live numbers from a theOovi reply: no extra request needed. */
export function noteHosted(live: HostedLive | undefined, displayName?: string) {
  const cur = g.__ooviHosted;
  if (!cur || !live) return;
  const next: HostedStatus = { ...cur, ...live, displayName: displayName || cur.displayName, message: null, checkedAt: Date.now() };
  next.state = stateFrom({ ...next, state: "ok" });
  if (next.state === "ok") next.message = null;
  g.__ooviHosted = next;
}

/** Records why a call was refused (no credits, today's limit, suspended…). */
export function noteHostedState(state: HostedState, message: string | null) {
  const cur = g.__ooviHosted;
  if (cur) g.__ooviHosted = { ...cur, state, message, checkedAt: Date.now() };
}

/** Largest request theOovi accepts (in tokens); the app compacts history to stay well below it. */
export const hostedMaxInput = () => g.__ooviHosted?.maxInputTokens || DEFAULT_MAX_INPUT;
/** How many theOovi calls may run at once from this app (several bots working at the same time share them). */
export const hostedMaxConcurrent = () => Math.min(50, Math.max(1, Math.floor(Number(g.__ooviHosted?.maxConcurrent) || 3)));

export async function hostedStatus(fresh = false): Promise<HostedStatus | null> {
  if (!sessionToken()) {
    g.__ooviHosted = null;
    return null;
  }
  const cur = g.__ooviHosted;
  if (!fresh && cur && cur.state !== "offline" && Date.now() - (g.__ooviHostedAt ?? 0) < FRESH_MS) return cur;
  try {
    const s = await cloud<Omit<HostedStatus, "checkedAt">>("/api/v1/ai/status", { auth: true });
    const next: HostedStatus = { ...s, displayName: s.displayName || HOSTED_NAME, checkedAt: Date.now() };
    g.__ooviHosted = next;
    g.__ooviHostedAt = Date.now();
    return next;
  } catch (e) {
    const status = e instanceof CloudError ? e.status : 0;
    if (status === 401) return null;
    const state: HostedState = status === 403 ? "blocked" : "offline";
    const message =
      status === 403
        ? (e as Error).message
        : status === 0
          ? "You're offline. Credits will update when the connection is back."
          : "Couldn't reach the oovi account service. Credits will update shortly.";
    // Keep the last known numbers so the app can still show them, marked offline.
    const base: HostedStatus = cur ?? {
      state,
      message,
      displayName: HOSTED_NAME,
      balance: 0,
      dailyLimit: 0,
      dailyUsed: 0,
      resetsAt: nextMidnight(),
      plan: { id: "free", name: "Free" },
      planUntil: null,
      maxInputTokens: DEFAULT_MAX_INPUT,
      links: { subscribe: "", pricing: "", pilot: "", feedback: "" },
      pilot: { open: false, eligible: false, status: null, credits: 0 },
      checkedAt: 0,
    };
    const next = { ...base, state, message };
    g.__ooviHosted = next;
    return next;
  }
}
