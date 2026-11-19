// Cloud sync (optional, off by default): this computer's chats and connectors follow the account, so the phone
// and the user's other computers see them, and the phone can give this computer work while it is open.
// Contract: docs/CLOUD-BUILD.md (API under the website's /api/v1/cloud). Rules (pure, tested): lib/cloud-sync-core.ts.
//
// What goes up: chats whose bots are all "in the cloud" (Edit bot), as text (files stay here); each connector's
// settings and sign-in (to the account's vault, encrypted there). What never goes up: the model API keys, search
// keys, saved website passwords, chats of bots set to "On this computer only".
//
// How:
// - turning it on uploads the old chats in the background; afterwards every saved change is pushed a moment
//   later, and the account's changes are pulled every 15 s (and when the app window gets the focus);
// - entries are merged by id (lib/cloud-sync-core.ts mergeChat); a 409 (another device saved first) is merged
//   and sent again; deletions are tombstones on the account (DELETE), so other devices delete too;
// - the desktop worker: every 3 s it asks the account for work the phone sent (a message, an approval answer,
//   Stop), runs it with the normal runner and pushes the chat as it changes, so the phone sees it live;
// - turning it off (Settings > Sync) deletes the account's copy at once; this computer keeps its own.
// It belongs to the signed-in account and never throws into the app. Nothing here logs chat content.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appVersion, baseDir, cloudUrl, currentUser, sessionToken } from "./account";
import {
  agreedBase,
  chatHash,
  chatTravels,
  entryBase,
  forUpload,
  hashOf,
  jobEntryId,
  jobInput,
  mergeChat,
  problemOf,
  retryAfter,
  scrubSecrets,
  vaultAction,
  vaultMerge,
  withoutJobEntry,
  type EntryBase,
  type SyncProblem,
  type VaultItem,
  type VaultMark,
} from "./cloud-sync-core";
import { secretsToHide } from "./logins";
import { connectorBots, setConnectorBots, turnOnForMain } from "./connectors";
import { applyVaultConnector, removeServer, vaultConnectors } from "./mcp";
import type { RunInput } from "./orchestrator";
import { isRunning, onRunEnd, startRun, steerRun, stopRun, whenIdle } from "./runner";
import { dataDir, loadSettings } from "./settings";
import { deleteChat, getBot, getChat, ID_RE, listBots, listChats, onChatChange, saveChat } from "./store";
import { syncSetup } from "./setup-sync";
import type { Chat } from "./types";

const API = "/api/v1/cloud";
const PULL_MS = 15_000;
const CLAIM_MS = 3_000;
const STATUS_MS = 60_000;
const PUSH_DELAY = 1_500;
const PUSH_DELAY_RUNNING = 800;
const MAX_JOBS = 3;

// ---------- state on disk (per account) ----------

type State = {
  /** Sync is on for this computer. */
  enabled: boolean;
  /** The user answered the question (first run, or once after the update). */
  asked: boolean;
  /** The account said "on" at least once since it was turned on here (so "off" there means turned off elsewhere). */
  seenOn?: boolean;
  /** Sync was turned off on another device (shown once in Settings). */
  offElsewhere?: boolean;
  /** The `now` of the last chat list: the next list asks only for what changed since. */
  since?: string;
  lastSync?: number;
  problem?: SyncProblem;
  /** Over the account's size limit: new chats stay here. */
  tooBig?: boolean;
  /** Connectors removed on another device (the phone) and so removed here: one line in Settings > Sync. */
  removed?: { names: string[]; at: number };
  /** Chats from the account whose bots this computer doesn't have yet: tried again at each sync. */
  waiting?: string[];
  vault?: Record<string, VaultMark>;
};
/** One chat as at its last sync: the account's version, this computer's fingerprint, the entries both agreed on. */
type Mark = { v: number; h: string; base: EntryBase; /** The account has entries this computer couldn't save yet (its bots were working). */ stale?: boolean };

const stateFile = () => path.join(dataDir(), "cloud-sync.json");
const marksDir = () => path.join(dataDir(), "cloud-sync");
const markFile = (id: string) => path.join(marksDir(), `${id}.json`);

function readState(): State {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as State;
    return { ...j, enabled: j.enabled === true, asked: j.asked === true };
  } catch {
    return { enabled: false, asked: false };
  }
}
function writeState(patch: Partial<State>): State {
  const next = { ...readState(), ...patch };
  for (const k of Object.keys(next) as (keyof State)[]) if (next[k] === undefined) delete next[k];
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, stateFile());
  return next;
}
function readMark(id: string): Mark | null {
  try {
    const m = JSON.parse(fs.readFileSync(markFile(id), "utf8")) as Mark;
    return typeof m.v === "number" && m.base ? m : null;
  } catch {
    return null;
  }
}
function writeMark(id: string, m: Mark) {
  fs.mkdirSync(marksDir(), { recursive: true });
  fs.writeFileSync(markFile(id), JSON.stringify(m));
}
const dropMark = (id: string) => fs.rmSync(markFile(id), { force: true });
const markedIds = (): string[] => {
  try {
    return fs.readdirSync(marksDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id));
  } catch {
    return [];
  }
};

/** This computer, for the account's device list (the same for every account on it). */
export function deviceId(): string {
  const p = path.join(baseDir(), ".device-id");
  try {
    const id = fs.readFileSync(p, "utf8").trim();
    if (/^[a-f0-9]{16,64}$/.test(id)) return id;
  } catch {
    /* first time */
  }
  const id = crypto.randomBytes(12).toString("hex");
  fs.mkdirSync(baseDir(), { recursive: true });
  fs.writeFileSync(p, id);
  return id;
}

// ---------- runtime (one per server process) ----------

type RemoteStatus = { enabled: boolean; bytes: number; limit: number; chats: number; lastSync: string | null; devices: { deviceId: string; kind: string; lastSeen: string; online: boolean }[] };
type Runtime = {
  user?: string;
  started?: boolean;
  syncing?: Promise<void>;
  failures: number;
  nextAt: number;
  statusAt: number;
  remote?: RemoteStatus;
  upload?: { done: number; total: number };
  locks: Map<string, Promise<unknown>>;
  pushTimers: Map<string, NodeJS.Timeout>;
  deferred: Set<string>;
  jobs: Set<string>;
  claiming?: boolean;
  /** Chats saved here since their last push (a full look at every chat only every few minutes). */
  dirty: Set<string>;
  fullAt: number;
  /** Chats over the per-chat size (413 too_big), with their fingerprint: tried again only once they change. */
  tooLong: Map<string, string>;
};
const g = globalThis as typeof globalThis & { __ooviCloudSync?: Runtime };
const rt: Runtime = (g.__ooviCloudSync ??= { failures: 0, nextAt: 0, statusAt: 0, locks: new Map(), pushTimers: new Map(), deferred: new Set(), jobs: new Set(), dirty: new Set(), fullAt: 0, tooLong: new Map() });
const FULL_SCAN_MS = 5 * 60_000;

/** A different account signed in: forget what was learned about the last one. */
function sameUser(): boolean {
  const u = currentUser()?.id;
  if (rt.user !== u) {
    rt.user = u;
    rt.remote = undefined;
    rt.upload = undefined;
    rt.failures = 0;
    rt.nextAt = 0;
    rt.statusAt = 0;
    rt.deferred.clear();
    rt.dirty.clear();
    rt.fullAt = 0;
  }
  return !!u;
}

const active = () => sameUser() && !!sessionToken() && readState().enabled;

/** One chat at a time: a push, a pull and a job never touch the same chat together. */
function withChat<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = rt.locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  rt.locks.set(id, next);
  void next.catch(() => {}).finally(() => {
    if (rt.locks.get(id) === next) rt.locks.delete(id);
  });
  return next;
}

// ---------- talking to the account ----------

class SyncError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`cloud ${status}`);
  }
}

/** Everything that must never leave this computer, looked for in every request as a last line of defence. */
function secrets(): string[] {
  const out: string[] = [];
  try {
    const s = loadSettings();
    for (const p of Object.values(s.providers)) if (p?.apiKey) out.push(p.apiKey);
    if (s.search.braveKey) out.push(s.search.braveKey);
    if (s.search.tavilyKey) out.push(s.search.tavilyKey);
    if (s.sandbox?.e2bKey) out.push(s.sandbox.e2bKey);
  } catch {
    /* settings unreadable: nothing to add */
  }
  try {
    out.push(...secretsToHide());
  } catch {
    /* no saved logins */
  }
  const t = sessionToken();
  if (t) out.push(t);
  return out;
}

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  if (!token) throw new SyncError(401, null);
  const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${token}`, "x-oovi-version": appVersion(), "x-oovi-platform": process.platform, "x-oovi-device": `desktop:${deviceId()}` };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = scrubSecrets(JSON.stringify(body), secrets());
  }
  let res: Response;
  try {
    res = await fetch(`${cloudUrl()}${API}${route}`, { method, headers, body: payload, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new SyncError(0, null);
  }
  if (res.status === 204) return undefined as T;
  let j: unknown = null;
  try {
    j = await res.json();
  } catch {
    j = null;
  }
  if (!res.ok) throw new SyncError(res.status, j);
  return j as T;
}
const statusOf = (e: unknown) => (e instanceof SyncError ? e.status : 0);
/** The website's stable error code ({error, code}), e.g. "sync_off", "over_limit", "too_big". */
const codeOf = (e: unknown): string | null => {
  const b = e instanceof SyncError ? (e.body as { code?: unknown } | null) : null;
  return typeof b?.code === "string" ? b.code : null;
};

// ---------- which chats travel ----------

function chatHere(id: string): Chat | null {
  if (!ID_RE.test(id) || !fs.existsSync(path.join(dataDir(), "chats", `${id}.json`))) return null;
  return getChat(id);
}
const travels = (c: Chat, bots = listBots()) => chatTravels(c, bots);

// ---------- pushing one chat ----------

/** GET /chats/<id> and a 409 on PUT (web/lib/cloud-types.ts): `chat` is null for a tombstone. */
type RemoteChat = { chatId?: string; version: number; deleted?: boolean; chat: Chat | null };

/** Sends this computer's copy of a chat (merging first when the account has a newer one). Call inside withChat. */
async function pushLocked(id: string): Promise<void> {
  const chat = chatHere(id);
  const mark = readMark(id);
  if (!chat || !travels(chat)) {
    // Deleted here, or its bots moved to "On this computer only": the account's copy goes.
    if (mark) {
      await call("DELETE", `/chats/${encodeURIComponent(id)}`).catch((e) => {
        if (statusOf(e) !== 404) throw e;
      });
      dropMark(id);
    }
    return;
  }
  if (mark && !mark.stale && mark.h === chatHash(chat)) return;
  if (!mark && readState().tooBig) return;
  if (rt.tooLong.get(id) === chatHash(chat)) return;
  rt.tooLong.delete(id);
  const running = isRunning(id);
  let send: Chat = chat;
  let baseVersion = mark?.v ?? 0;
  if (mark?.stale) {
    const r = await call<RemoteChat>("GET", `/chats/${encodeURIComponent(id)}`).catch((e) => (statusOf(e) === 404 ? null : Promise.reject(e)));
    if (r?.chat && !r.deleted) {
      send = mergeChat(chat, r.chat, mark.base, running);
      baseVersion = r.version;
    }
  }
  let version = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      version = (await call<{ version: number }>("PUT", `/chats/${encodeURIComponent(id)}`, { baseVersion, chat: forUpload(send) })).version;
      break;
    } catch (e) {
      const st = statusOf(e);
      if (st === 413) {
        if (codeOf(e) === "too_big") {
          // This one chat is over the per-chat size: it stays here (until it changes); the others go on.
          rt.tooLong.set(id, chatHash(chat));
          writeState({ problem: "chatTooBig" });
        } else writeState({ tooBig: true, problem: "tooBig" });
        return;
      }
      const theirs = (e as SyncError).body as RemoteChat | null;
      if (st !== 409 || attempt >= 3 || !theirs || typeof theirs.version !== "number") throw e;
      if (theirs.deleted || !theirs.chat) {
        // Deleted on another device. Synced here before: deleted here too. Never synced: sent again as new.
        if (mark && !isRunning(id)) {
          deleteChat(id, { quiet: true });
          dropMark(id);
          return;
        }
        send = chatHere(id) ?? chat;
        baseVersion = theirs.version;
        continue;
      }
      // Another device saved first: merge with its copy and send again.
      send = mergeChat(chatHere(id) ?? chat, theirs.chat, mark?.base ?? null, isRunning(id));
      baseVersion = theirs.version;
    }
  }
  let here = chatHere(id) ?? chat;
  if (send !== chat && !isRunning(id) && chatHash(send) !== chatHash(here)) {
    saveMerged(send, here);
    here = send;
  }
  const stale = chatHash(here) !== chatHash(send);
  writeMark(id, { v: version, h: chatHash(here), base: agreedBase(send, here), ...(stale ? { stale: true } : {}) });
}

/** A chat changed here: pushed a moment later (sooner while its bots work, so the phone sees them live). */
function schedulePush(id: string) {
  if (!active()) return;
  rt.dirty.add(id);
  const t = rt.pushTimers.get(id);
  // While the bots work the chat is saved often: one push every moment, not one after they stop.
  if (t && isRunning(id)) return;
  if (t) clearTimeout(t);
  rt.pushTimers.set(
    id,
    setTimeout(
      () => {
        rt.pushTimers.delete(id);
        void withChat(id, () => pushLocked(id)).then(() => {
          rt.dirty.delete(id);
          ok();
        }, fail);
      },
      isRunning(id) ? PUSH_DELAY_RUNNING : PUSH_DELAY,
    ),
  );
}

/** A merged copy saved here: never older than what was here, so an open chat window shows the change. */
function saveMerged(merged: Chat, here: Chat) {
  merged.updatedAt = Math.max(merged.updatedAt, here.updatedAt + 1);
  saveChat(merged, { quiet: true });
}

// ---------- pulling one chat ----------

/** Brings the account's copy of a chat here (merged). remoteVersion: skip it when already this version. */
async function pullLocked(id: string, remoteVersion?: number): Promise<"ok" | "later" | "skip"> {
  const mark = readMark(id);
  if (mark && !mark.stale && remoteVersion !== undefined && mark.v >= remoteVersion) return "ok";
  if (isRunning(id)) {
    // Its bots are working here: the run saves the chat; the account's changes are merged when it ends.
    rt.deferred.add(id);
    return "later";
  }
  const r = await call<RemoteChat>("GET", `/chats/${encodeURIComponent(id)}`).catch((e) => (statusOf(e) === 404 ? null : Promise.reject(e)));
  if (!r?.chat || r.deleted || !Array.isArray(r.chat.entries)) return "skip";
  const remote = forUpload({ ...r.chat, id }) as Chat;
  const bots = listBots();
  const local = chatHere(id);
  if (local && !travels(local, bots)) return "skip";
  if (!local) {
    // A chat this computer doesn't have: only when it knows all its bots (their setup arrives by setup sync).
    if (!remote.memberIds?.length || !remote.memberIds.every((m) => bots.some((b) => b.id === m))) return "later";
    if (!travels(remote, bots)) return "skip";
    saveChat(remote, { quiet: true });
    writeMark(id, { v: r.version, h: chatHash(remote), base: entryBase(remote) });
    return "ok";
  }
  const merged = mergeChat(local, remote, mark?.base ?? null);
  if (chatHash(merged) !== chatHash(local)) saveMerged(merged, local);
  if (chatHash(merged) === chatHash(remote)) {
    writeMark(id, { v: r.version, h: chatHash(merged), base: entryBase(merged) });
  } else {
    // This computer had changes the account didn't: send the merged copy.
    writeMark(id, { v: r.version, h: "", base: mark?.base ?? {} });
    await pushLocked(id);
  }
  return "ok";
}

// ---------- one full sync ----------

type ChatListItem = { chatId: string; version: number; updatedAt?: string; deleted?: boolean; bytes?: number };

async function refreshStatus(force = false): Promise<RemoteStatus | undefined> {
  if (!force && rt.remote && Date.now() - rt.statusAt < STATUS_MS) return rt.remote;
  const s = await call<RemoteStatus>("GET", "/status");
  rt.remote = s;
  rt.statusAt = Date.now();
  return s;
}

async function syncOnce(): Promise<void> {
  if (!active()) return;
  const remote = await refreshStatus();
  let st = readState();
  if (remote && !remote.enabled) {
    if (st.seenOn) {
      turnedOffElsewhere();
      return;
    }
    await call("PUT", "/status", { enabled: true });
    rt.statusAt = 0;
  }
  st = writeState({ seenOn: true, ...(remote && remote.limit > 0 && remote.bytes < remote.limit && st.tooBig ? { tooBig: false } : {}) });

  // 1. What changed on the account.
  const list = await call<{ chats: ChatListItem[]; now: string }>("GET", `/chats${st.since ? `?since=${encodeURIComponent(st.since)}` : ""}`);
  const waiting = new Set(st.waiting ?? []);
  for (const item of list.chats ?? []) {
    const id = String(item.chatId ?? "");
    if (!ID_RE.test(id)) continue;
    if (item.deleted) {
      await withChat(id, async () => {
        if (!readMark(id)) return;
        if (isRunning(id)) {
          rt.deferred.add(id);
          return;
        }
        deleteChat(id, { quiet: true });
        dropMark(id);
      });
      waiting.delete(id);
      continue;
    }
    const r = await withChat(id, () => pullLocked(id, item.version));
    if (r === "later" && !isRunning(id)) waiting.add(id);
    else waiting.delete(id);
  }
  // Chats that waited for their bots: tried again.
  for (const id of [...waiting]) {
    if (list.chats?.some((c) => c.chatId === id)) continue;
    const r = await withChat(id, () => pullLocked(id));
    if (r !== "later") waiting.delete(id);
  }
  writeState({ since: list.now || st.since, waiting: [...waiting].slice(-500) });

  // 2. What changed here: every chat the first time (the old chats, most recent first) and every few minutes
  // (a bot moved to "this computer only", a chat restored from a backup); otherwise only the chats saved since.
  if (!rt.fullAt || Date.now() - rt.fullAt > FULL_SCAN_MS) {
    const scanAt = Date.now();
    const bots = listBots();
    const chats = listChats().filter((c) => travels(c, bots)).sort((a, b) => b.updatedAt - a.updatedAt);
    const todo = chats.filter((c) => {
      const m = readMark(c.id);
      return !m || m.stale || m.h !== chatHash(c);
    });
    const ids = new Set(chats.map((c) => c.id));
    const gone = markedIds().filter((id) => !ids.has(id));
    if (todo.length > 5) rt.upload = { done: 0, total: todo.length };
    try {
      for (const c of todo) {
        await withChat(c.id, () => pushLocked(c.id));
        rt.dirty.delete(c.id);
        if (rt.upload) rt.upload.done++;
        if (readState().tooBig && !readMark(c.id)) break;
      }
    } finally {
      rt.upload = undefined;
    }
    for (const id of gone) await withChat(id, () => pushLocked(id));
    rt.fullAt = scanAt;
  } else {
    for (const id of [...rt.dirty]) {
      await withChat(id, () => pushLocked(id));
      rt.dirty.delete(id);
    }
  }

  // 3. Connectors.
  await syncVault();
  writeState({ lastSync: Date.now(), problem: readState().tooBig ? "tooBig" : rt.tooLong.size ? "chatTooBig" : undefined });
}

/** Turned off on another device: the account's copy is gone; this computer stops too (and keeps its chats). */
function turnedOffElsewhere() {
  for (const t of rt.pushTimers.values()) clearTimeout(t);
  rt.pushTimers.clear();
  rt.dirty.clear();
  rt.fullAt = 0;
  forgetMarks();
  writeState({ enabled: false, seenOn: false, offElsewhere: true, since: undefined, vault: undefined, waiting: undefined, problem: undefined, tooBig: undefined, removed: undefined });
}

function forgetMarks() {
  fs.rmSync(marksDir(), { recursive: true, force: true });
}

// ---------- connectors (vault) ----------

type VaultListItem = { connectorId: string; version: number; updatedAt?: string };

/** A connector as sent: model keys can never be in it (scrubbed again in call()). */
const vaultHash = (item: VaultItem) => hashOf(item);

/** This computer's connectors, each with the bots that use it. */
function localVault(): Map<string, VaultItem> {
  return new Map(vaultConnectors().map(({ id, ...item }) => [id, { ...item, bots: connectorBots(id) } as VaultItem]));
}

/** A connector from the vault, applied here: its settings and sign-in, on/off, and which bots use it. */
async function applyFromVault(id: string, got: VaultItem, isNew: boolean): Promise<boolean> {
  if (!(await applyVaultConnector(id, got))) return false;
  const known = new Set(listBots().map((b) => b.id));
  if (Array.isArray(got.bots)) setConnectorBots(id, got.bots.filter((b) => typeof b === "string" && known.has(b)));
  else if (isNew) turnOnForMain(id);
  return true;
}

async function syncVault(): Promise<void> {
  const listed = await call<{ items?: VaultListItem[] }>("GET", "/vault");
  // A connector missing from the list was removed elsewhere: so the list must be a real answer, never a guess.
  if (!Array.isArray(listed?.items)) throw new SyncError(502, null);
  const remote = new Map<string, number>();
  for (const x of listed.items) if (x && typeof x.connectorId === "string") remote.set(x.connectorId, Number(x.version) || 0);
  const marks = { ...(readState().vault ?? {}) };
  const local = localVault();
  const removedNames: string[] = [];
  const ids = new Set([...local.keys(), ...remote.keys(), ...Object.keys(marks)]);
  for (const id of ids) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) continue;
    const item = local.get(id);
    const rv = remote.has(id) ? remote.get(id)! : null;
    const action = vaultAction(item ? vaultHash(item) : null, marks[id], rv);
    try {
      if (action === "pull") {
        const r = await call<{ version: number; data?: VaultItem }>("GET", `/vault/${encodeURIComponent(id)}`);
        const got = r.data;
        if (got && (await applyFromVault(id, got, !item))) {
          const now = localVault().get(id);
          if (now) marks[id] = { version: r.version, hash: vaultHash(now) };
        }
      } else if (action === "push" && item) {
        let send = item;
        let base = marks[id]?.version ?? 0;
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await call<{ version: number }>("PUT", `/vault/${encodeURIComponent(id)}`, { baseVersion: base, data: send });
            if (send !== item) await applyFromVault(id, send, false);
            marks[id] = { version: r.version, hash: vaultHash(localVault().get(id) ?? send) };
            break;
          } catch (e) {
            const theirs = (e as SyncError).body as { version?: number; data?: VaultItem | null } | null;
            const other = theirs?.data;
            if (statusOf(e) !== 409 || attempt >= 2 || !other || typeof theirs?.version !== "number") throw e;
            send = vaultMerge(item, other);
            base = theirs.version;
          }
        }
      } else if (action === "remove" && item) {
        // Removed on another device (the phone): removed here too, without asking; Settings > Sync says so.
        setConnectorBots(id, []);
        await removeServer(id);
        delete marks[id];
        removedNames.push(item.name);
      } else if (!item && marks[id] && action === "none") {
        // Removed here (setup sync removes it on the other computers): the account's copy goes too.
        await call("DELETE", `/vault/${encodeURIComponent(id)}`).catch((e) => {
          if (![404, 405].includes(statusOf(e))) throw e;
        });
        delete marks[id];
      }
    } catch (e) {
      if (statusOf(e) === 0 || statusOf(e) === 401) throw e;
      // One connector the account refused: the others still sync.
    }
  }
  writeState({ vault: marks, ...(removedNames.length ? { removed: { names: removedNames.slice(0, 10), at: Date.now() } } : {}) });
}

// ---------- the desktop worker (jobs from the phone) ----------

/** A claimed job (web/lib/cloud-types.ts ClaimedJob). */
type Job = { jobId: string; chatId: string; kind: string; payload?: unknown; was?: string };

async function claimOnce(): Promise<void> {
  if (rt.claiming || rt.jobs.size >= MAX_JOBS || !active()) return;
  const st = readState();
  if (st.problem === "signedOut" || st.problem === "notReady" || Date.now() < rt.nextAt) return;
  rt.claiming = true;
  try {
    const r = await call<{ job: Job | null }>("POST", "/jobs/claim", { deviceId: deviceId(), kind: "desktop" });
    if (r?.job?.jobId) void runJob(r.job);
  } catch (e) {
    fail(e);
  } finally {
    rt.claiming = false;
  }
}

async function runJob(job: Job): Promise<void> {
  rt.jobs.add(job.jobId);
  const jid = encodeURIComponent(job.jobId);
  const me = deviceId();
  const done = (status: "done" | "failed", error?: string) => call("POST", `/jobs/${jid}/done`, { deviceId: me, status, ...(error ? { error } : {}) }).catch(() => {});
  const beat = setInterval(() => void call("POST", `/jobs/${jid}/heartbeat`, { deviceId: me }).catch(() => {}), 30_000);
  try {
    const id = String(job.chatId ?? "");
    const ji = jobInput(job.kind, job.payload);
    if (!ID_RE.test(id) || !ji) return void (await done("failed", "bad_job"));
    // The phone's view may be newer than this computer's: bring the chat here first.
    await withChat(id, () => pullLocked(id).catch(() => "skip"));
    // A bot or group made on the phone moments ago may not be on this computer yet: fetch the account's setup
    // once, then look again (otherwise the phone's first message would end as "not on this computer").
    const known = (c: ReturnType<typeof chatHere>) => (c ? c.memberIds.every((m) => !!getBot(m)) : id.startsWith("dm-") && !!getBot(id.slice(3)));
    if (!known(chatHere(id))) {
      await syncSetup().catch(() => {});
      await withChat(id, () => pullLocked(id).catch(() => "skip"));
    }
    // A bot's own chat that was never opened on this computer has no file yet: it starts empty here, like in the app.
    if (!chatHere(id) && id.startsWith("dm-") && getBot(id.slice(3))) getChat(id);
    const chat = chatHere(id);
    if (!chat || !travels(chat)) return void (await done("failed", "not_on_this_computer"));
    if (ji.kind === "stop") {
      stopRun(id);
      await whenIdle(id, 15_000);
      await withChat(id, () => pushLocked(id)).catch(() => {});
      return void (await done("done"));
    }
    const input = ji.input as RunInput;
    if (job.kind === "message") {
      // The message gets the job's id; if the chat already holds it (the cloud runner answered "This needs your
      // computer", or let the job go), it and its answers go first: the message is run, and shows, once.
      input.entryId = jobEntryId(job.jobId, job.payload);
      if (!isRunning(id)) {
        const cur = chatHere(id);
        const fresh = cur ? withoutJobEntry(cur, input.entryId) : null;
        if (fresh) saveChat(fresh);
      }
    }
    if (isRunning(id)) {
      // A message while the bots work: read at their next step, as in the app.
      if (typeof input.text === "string" && steerRun(id, input)) return void (await done("done"));
      await whenIdle(id, 100_000);
    }
    if (!startRun(id, input)) return void (await done("failed", "busy"));
    // The run saves the chat as it goes; each save is pushed (schedulePush), so the phone sees it live.
    while (!(await whenIdle(id, 60_000))) {
      /* still working: the heartbeat keeps the job */
    }
    await withChat(id, () => pushLocked(id)).catch(() => {});
    await done("done");
  } catch (e) {
    await done("failed", e instanceof SyncError ? `http_${e.status}` : "error");
  } finally {
    clearInterval(beat);
    rt.jobs.delete(job.jobId);
  }
}

// ---------- results and errors ----------

function ok() {
  rt.failures = 0;
  rt.nextAt = 0;
}
function fail(e: unknown) {
  if (codeOf(e) === "sync_off") {
    // The account says sync is off: turned off on another device (this one turned it on and saw it on).
    try {
      if (currentUser() && readState().enabled) turnedOffElsewhere();
    } catch {
      /* disk full: try later */
    }
    return;
  }
  const p = problemOf(statusOf(e));
  rt.failures++;
  rt.nextAt = Date.now() + retryAfter(rt.failures);
  try {
    if (currentUser()) writeState({ problem: p });
  } catch {
    /* disk full: try later */
  }
}

/** One sync now (pull, push, connectors). Shared when one is already running. */
export function syncCloud(): Promise<void> {
  if (rt.syncing) return rt.syncing;
  rt.syncing = syncOnce()
    .then(ok, fail)
    .finally(() => (rt.syncing = undefined));
  return rt.syncing;
}

// ---------- what Settings shows, and the switch ----------

export type CloudStatus = {
  signedIn: boolean;
  enabled: boolean;
  asked: boolean;
  deviceId: string;
  lastSync: number | null;
  problem: SyncProblem | null;
  tooBig: boolean;
  offElsewhere: boolean;
  /** Connectors removed on another device in the last week (and so here). */
  removedConnectors: string[];
  /** Old chats being uploaded after turning sync on. */
  upload: { done: number; total: number } | null;
  /** Chats on this computer: synced, and kept here (their bots are "On this computer only"). */
  chats: { synced: number; localOnly: number };
  /** The account's side (null when off or unreachable). */
  remote: { bytes: number; limit: number; chats: number; lastSync: string | null; devices: { deviceId: string; kind: string; lastSeen: string; online: boolean; thisOne: boolean }[] } | null;
  jobs: number;
};

/** How many chats travel and how many stay here (read from every chat: cached for half a minute). */
let countsCache: { at: number; user?: string; v: { synced: number; localOnly: number } } | null = null;
function chatCounts() {
  if (countsCache && countsCache.user === rt.user && Date.now() - countsCache.at < 30_000) return countsCache.v;
  const bots = listBots();
  const chats = listChats().filter((c) => c.memberIds.length);
  const synced = chats.filter((c) => travels(c, bots)).length;
  countsCache = { at: Date.now(), user: rt.user, v: { synced, localOnly: chats.length - synced } };
  return countsCache.v;
}

export async function cloudStatus(fresh = false): Promise<CloudStatus> {
  sameUser();
  const signedIn = !!sessionToken();
  const st = signedIn ? readState() : { enabled: false, asked: true };
  let remote = rt.remote;
  if (signedIn && st.enabled && fresh) remote = await refreshStatus(true).catch(() => rt.remote);
  const counts = signedIn ? chatCounts() : { synced: 0, localOnly: 0 };
  const me = deviceId();
  return {
    signedIn,
    enabled: st.enabled,
    asked: st.asked,
    deviceId: me,
    lastSync: (st as State).lastSync ?? null,
    problem: (st as State).problem ?? null,
    tooBig: !!(st as State).tooBig,
    offElsewhere: !!(st as State).offElsewhere,
    removedConnectors: (st as State).removed && Date.now() - (st as State).removed!.at < 7 * 864e5 ? (st as State).removed!.names : [],
    upload: rt.upload ? { ...rt.upload } : null,
    chats: counts,
    remote: st.enabled && remote ? { bytes: remote.bytes, limit: remote.limit, chats: remote.chats, lastSync: remote.lastSync, devices: (remote.devices ?? []).map((d) => ({ ...d, thisOne: d.deviceId === me })) } : null,
    jobs: rt.jobs.size,
  };
}

/** The question (first run, or once after the update): "cloud" turns sync on, "local" keeps everything here. */
export async function answerCloudQuestion(choice: "cloud" | "local"): Promise<{ ok: boolean; problem?: SyncProblem }> {
  if (choice === "local") {
    writeState({ asked: true });
    return { ok: true };
  }
  return setCloudSync(true);
}

/** The switch in Settings > Sync. Off: the account's copy is deleted at once (this computer keeps its own). */
export async function setCloudSync(on: boolean): Promise<{ ok: boolean; problem?: SyncProblem }> {
  if (!sameUser() || !sessionToken()) return { ok: false, problem: "signedOut" };
  try {
    await call("PUT", "/status", { enabled: on });
  } catch (e) {
    return { ok: false, problem: problemOf(statusOf(e)) };
  }
  rt.statusAt = 0;
  rt.remote = undefined;
  rt.fullAt = 0;
  countsCache = null;
  ok();
  if (on) {
    writeState({ enabled: true, asked: true, seenOn: true, offElsewhere: undefined, problem: undefined, tooBig: undefined });
    startCloudSync();
    void syncCloud();
  } else {
    for (const t of rt.pushTimers.values()) clearTimeout(t);
    rt.pushTimers.clear();
    forgetMarks();
    writeState({ enabled: false, asked: true, seenOn: undefined, offElsewhere: undefined, since: undefined, vault: undefined, waiting: undefined, problem: undefined, tooBig: undefined, lastSync: undefined, removed: undefined });
  }
  return { ok: true };
}

// ---------- start ----------

/** Once per server process: listens for saved chats, pulls every 15 s, asks for the phone's work every 3 s. */
export function startCloudSync(): void {
  if (rt.started) return;
  rt.started = true;
  onChatChange((id) => {
    countsCache = null;
    schedulePush(id);
  });
  onRunEnd((id) => {
    // The account's changes that waited for this run.
    if (!rt.deferred.delete(id) && !readMarkSafe(id)?.stale) return;
    if (active()) void withChat(id, () => pullLocked(id)).then(ok, fail);
  });
  const pull = setInterval(() => {
    if (active() && Date.now() >= rt.nextAt) void syncCloud();
  }, PULL_MS);
  pull.unref?.();
  const claim = setInterval(() => void claimOnce(), CLAIM_MS);
  claim.unref?.();
  setTimeout(() => {
    if (active()) void syncCloud();
  }, 5_000).unref?.();
}

function readMarkSafe(id: string): Mark | null {
  try {
    return readMark(id);
  } catch {
    return null;
  }
}
