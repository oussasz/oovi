// The rules of chat sync (lib/cloud-sync.ts), pure so tests run them as is. No imports: nothing here reads the
// computer, the account or the network.
//
// A chat is a list of entries (messages and replies) plus a few chat-level fields. Two copies of a chat (this
// computer's and the account's) are merged entry by entry, three-way: each computer remembers a fingerprint of
// every entry as it was at the last sync (the "base"). For one entry:
// - only one side changed it since the base: that side wins;
// - an entry in the base that one side no longer has was deleted there (a chat cleared on the phone, say);
//   unless the other side changed it since, then the change is kept;
// - both changed it (or there is no base yet): the copy whose chat was saved last wins ("newer wins"), except
//   while this computer's bots are working on the chat, then this computer wins (its run is the live one).
// Entries keep this computer's order; the account's new entries are placed after the entry they followed there.

/** Fields of a chat, as far as merging is concerned (lib/types.ts Chat has many more; they travel untouched). */
export type SyncEntry = { id: string; at?: number; [k: string]: unknown };
export type SyncChat = { id: string; updatedAt: number; memberIds: string[]; entries: SyncEntry[]; [k: string]: unknown };
/** entry id → fingerprint at the last sync. */
export type EntryBase = Record<string, string>;

// ---------- fingerprints ----------

function stable(v: unknown): string {
  if (v === undefined) return "u";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

/** A short, stable fingerprint (key order doesn't matter). FNV-1a, 2×32 bits. */
export function hashOf(v: unknown): string {
  const s = stable(v);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** The chat's fingerprint, ignoring when it was saved (a save that changed nothing isn't a change). */
export const chatHash = (c: SyncChat): string => hashOf({ ...c, updatedAt: undefined });

export const entryBase = (c: SyncChat): EntryBase => Object.fromEntries(c.entries.map((e) => [e.id, hashOf(e)]));

// ---------- merging ----------

/**
 * Merges this computer's chat with the account's. base: the entries at the last sync (null: never synced).
 * localWins: this computer's bots are working on the chat right now.
 */
export function mergeChat<T extends SyncChat>(local: T, remote: SyncChat, base: EntryBase | null, localWins = false): T {
  const newerLocal = localWins || local.updatedAt >= remote.updatedAt;
  const lById = new Map(local.entries.map((e) => [e.id, e]));
  const rById = new Map(remote.entries.map((e) => [e.id, e]));
  const pick = (id: string): SyncEntry | undefined => {
    const l = lById.get(id);
    const r = rById.get(id);
    const lh = l && hashOf(l);
    const rh = r && hashOf(r);
    if (lh === rh) return l;
    const b = base?.[id];
    if (b === undefined) {
      // New on one side, or new on both with the same id (never edited before a sync): keep what exists.
      if (!l || !r) return l ?? r;
      return newerLocal ? l : r;
    }
    const lChanged = lh !== b;
    const rChanged = rh !== b;
    if (!l) return rChanged ? r : undefined; // deleted here; kept only if the account changed it since
    if (!r) return lChanged ? l : undefined; // deleted there; kept only if this computer changed it since
    if (lChanged && !rChanged) return l;
    if (rChanged && !lChanged) return r;
    return newerLocal ? l : r;
  };

  const out: SyncEntry[] = [];
  const placed = new Set<string>();
  for (const e of local.entries) {
    const v = pick(e.id);
    if (v) out.push(v);
    placed.add(e.id);
  }
  // The account's entries this computer doesn't have: after the entry they follow in the account's copy.
  let after: string | null = null;
  for (const e of remote.entries) {
    if (placed.has(e.id)) {
      if (out.some((x) => x.id === e.id)) after = e.id;
      continue;
    }
    const v = pick(e.id);
    placed.add(e.id);
    if (!v) continue;
    const i = after === null ? -1 : out.findIndex((x) => x.id === after);
    // Nothing in common before it: placed by its time (before this computer's first newer entry, else at the end).
    const at = i >= 0 ? i + 1 : firstAfter(out, typeof v.at === "number" ? v.at : 0);
    out.splice(at, 0, v);
    if (after !== null) after = v.id;
  }

  const meta = newerLocal ? local : (remote as unknown as T);
  const merged = { ...meta, id: local.id, entries: out, updatedAt: Math.max(local.updatedAt, remote.updatedAt) } as T;
  // What this computer allows in this chat stays this computer's (never taken from another device).
  for (const k of HERE_ONLY) {
    if (local[k] === undefined) delete (merged as Record<string, unknown>)[k];
    else (merged as Record<string, unknown>)[k] = local[k];
  }
  // A summary that points at an entry that is gone no longer describes this chat.
  const sum = merged.summary as { upTo?: string } | undefined;
  if (sum && typeof sum.upTo === "string" && !out.some((e) => e.id === sum.upTo)) delete (merged as Record<string, unknown>).summary;
  return merged;
}

/**
 * Chat fields that belong to this computer and never travel: the project folder (a path here, with "edit without
 * asking") and the actions allowed for the rest of the chat. Taking them from another device would let it grant
 * itself permissions on this computer.
 */
export const HERE_ONLY = ["workspace", "allow"] as const;

/** The chat as sent to the account: without this computer's own fields. */
export function forUpload<T extends Record<string, unknown>>(chat: T): T {
  const out = { ...chat };
  for (const k of HERE_ONLY) delete out[k];
  return out;
}

function firstAfter(list: SyncEntry[], at: number): number {
  if (!list.length) return 0;
  const i = list.findIndex((x) => typeof x.at === "number" && x.at > at);
  return i < 0 ? list.length : i;
}

/** The base to remember after a sync: the entries both copies now agree on (the merged ones this computer saved). */
export function agreedBase(merged: SyncChat, savedHere: SyncChat): EntryBase {
  const here = entryBase(savedHere);
  const out: EntryBase = {};
  for (const e of merged.entries) {
    const h = hashOf(e);
    if (here[e.id] === h) out[e.id] = h;
  }
  return out;
}

// ---------- which chats travel ----------

export type SyncBot = { id: string; local?: boolean };

/**
 * A chat travels only when every bot in it is "in the cloud" (a group with one local bot stays on this computer).
 * Bots the computer no longer knows don't block it. A chat with no bots never travels.
 */
export function chatTravels(chat: { memberIds: string[] }, bots: SyncBot[]): boolean {
  if (!chat.memberIds.length) return false;
  const byId = new Map(bots.map((b) => [b.id, b]));
  return chat.memberIds.every((id) => byId.get(id)?.local !== true);
}

// ---------- secrets never leave ----------

/** Secrets shorter than this are too common to look for (and no real key is that short). */
const MIN_SECRET = 8;

/** The text with every given secret replaced. Used on everything sent, as a last line of defence. */
export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of [...new Set(secrets)].filter((x) => typeof x === "string" && x.length >= MIN_SECRET).sort((a, b) => b.length - a.length)) {
    // Also as it appears inside JSON (quotes and backslashes escaped).
    for (const form of new Set([s, JSON.stringify(s).slice(1, -1)])) out = out.split(form).join("[hidden]");
  }
  return out;
}

export const hasSecret = (text: string, secrets: readonly string[]): boolean => scrubSecrets(text, secrets) !== text;

// ---------- jobs sent from the phone ----------

export type JobKind = "message" | "decision" | "stop";
export type JobInput =
  | { kind: "stop" }
  | { kind: "run"; input: Record<string, unknown> };

const EFFORTS = ["auto", "low", "medium", "high", "max"];
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

/**
 * What a job asks the bots to do, cleaned like the app's own run request (app/api/chats/[id]/run): a message
 * {text, effort?, deep?, plan?, entryId?, replyTo?}; a decision {decisions} | {planDecision} | {answers}; or stop.
 * Files can't come from the phone yet. Null: nothing usable.
 */
export function jobInput(kind: unknown, payload: unknown): JobInput | null {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (kind === "stop") return { kind: "stop" };
  if (kind === "message") {
    const text = typeof p.text === "string" ? p.text.trim() : "";
    if (!text || text.length > 20_000) return null;
    return {
      kind: "run",
      input: {
        text,
        ...(EFFORTS.includes(String(p.effort)) ? { effort: p.effort } : {}),
        deep: p.deep === true,
        plan: p.plan === true,
        ...(str(p.entryId, 40) ? { entryId: str(p.entryId, 40) } : {}),
        ...(str(p.replyTo, 40) ? { replyTo: str(p.replyTo, 40) } : {}),
      },
    };
  }
  if (kind !== "decision") return null;
  if (p.planDecision && typeof p.planDecision === "object") {
    const d = p.planDecision as { approve?: unknown; items?: unknown };
    const items = Array.isArray(d.items) ? d.items.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    return { kind: "run", input: { planDecision: { approve: d.approve === true, items } } };
  }
  if ("answers" in p && (p.answers === null || Array.isArray(p.answers))) {
    const answers = p.answers === null ? null : (p.answers as unknown[]).slice(0, 4).map((x) => (typeof x === "string" ? x.slice(0, 1000) : ""));
    return { kind: "run", input: { answers } };
  }
  if (p.decisions && typeof p.decisions === "object") {
    const decisions: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(p.decisions as Record<string, unknown>)) if (typeof v === "boolean" && /^[\w-]{1,80}$/.test(k)) decisions[k] = v;
    if (!Object.keys(decisions).length) return null;
    // "Always allow" choices change this computer's rules for good: only the plain yes/no comes from the phone.
    return { kind: "run", input: { decisions, allowChat: p.allowChat === true } };
  }
  return null;
}

// ---------- errors, in plain words (keys of lib/i18n) ----------

export type SyncProblem = "offline" | "signedOut" | "tooBig" | "notReady" | "server";

/** status: the HTTP status of a failed call (0: no answer). */
export function problemOf(status: number): SyncProblem {
  if (status === 0) return "offline";
  if (status === 401 || status === 403) return "signedOut";
  if (status === 413) return "tooBig";
  if (status === 404 || status === 405 || status === 501) return "notReady";
  return "server";
}

/** How long to wait before trying again after failures in a row (ms): 15 s, 30 s, 1 min… up to 5 min. */
export const retryAfter = (failures: number): number => Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, failures - 1));

// ---------- connectors in the vault ----------

export type VaultMark = { version: number; hash: string };

/**
 * What to do with one connector. local: its fingerprint here (null: not here). mark: as at the last sync.
 * remoteVersion: the account's version (null: not in the account).
 */
export function vaultAction(local: string | null, mark: VaultMark | undefined, remoteVersion: number | null): "push" | "pull" | "none" {
  if (local === null) return remoteVersion !== null && (!mark || remoteVersion > mark.version) ? "pull" : "none";
  const changedHere = !mark || mark.hash !== local;
  const changedThere = remoteVersion !== null && (!mark || remoteVersion > mark.version);
  if (changedHere) return "push"; // a 409 then brings the account's copy, merged by vaultMerge
  if (changedThere) return "pull";
  return remoteVersion === null ? "push" : "none";
}

export type VaultItem = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth?: "oauth";
  env?: Record<string, string>;
  headers?: Record<string, string>;
  oauth?: { clientInfo?: unknown; tokens?: unknown; signedInAt?: number };
  enabled: boolean;
  trusted: boolean;
  createdAt?: number;
};

/** Two copies of one connector changed on two computers: this one's settings, the freshest sign-in, no key lost. */
export function vaultMerge(local: VaultItem, remote: VaultItem): VaultItem {
  const fill = (a?: Record<string, string>, b?: Record<string, string>) => {
    if (!a && !b) return undefined;
    const out = { ...(b ?? {}), ...(a ?? {}) };
    for (const k of Object.keys(out)) if (!out[k] && b?.[k]) out[k] = b[k]!;
    return out;
  };
  const lAt = local.oauth?.signedInAt ?? 0;
  const rAt = remote.oauth?.signedInAt ?? 0;
  const oauth = !local.oauth?.tokens ? (remote.oauth ?? local.oauth) : !remote.oauth?.tokens ? local.oauth : rAt > lAt ? remote.oauth : local.oauth;
  return { ...local, env: fill(local.env, remote.env), headers: fill(local.headers, remote.headers), ...(oauth ? { oauth } : {}) };
}
