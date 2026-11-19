"use client";

// Calls from the phone app to the website (same origin, the website's session cookie; no key is ever sent or
// kept here). The cloud API is the contract in docs/CLOUD-BUILD.md (/api/v1/cloud); bots and connectors come
// from the account's setup (/api/v1/setup), credits from /api/v1/ai/status, voice notes from /api/v1/ai/transcribe.
import type { PendingSignIn, VaultItem } from "./connectors";
import type { Chat, ChatListItem, CloudStatus, Credits, JobInfo, JobPayload, Me } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
  /** The website's stable error code (web/lib/cloud-types.ts CloudError), e.g. "sync_off", "busy". */
  get code(): string | null {
    const c = (this.body as { code?: unknown } | null)?.code;
    return typeof c === "string" ? c : null;
  }
}

export const SIGNED_OUT_EVENT = "oovi-m-signed-out";

let deviceIdCache: string | null = null;
/** This phone's id for the cloud's device list (kept in this browser only). */
export function deviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  let id = "";
  try {
    id = localStorage.getItem("oovi.m.device") ?? "";
  } catch {
    /* private mode */
  }
  if (!/^[a-z0-9-]{8,64}$/.test(id)) {
    id = `phone-${(crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase()}`;
    try {
      localStorage.setItem("oovi.m.device", id);
    } catch {
      /* private mode */
    }
  }
  deviceIdCache = id;
  return id;
}

async function call<T>(path: string, init: RequestInit & { json?: unknown; quiet401?: boolean } = {}): Promise<T> {
  const { json, quiet401, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("accept", "application/json");
  if (path.startsWith("/api/v1/cloud")) headers.set("x-oovi-device", `phone:${deviceId()}`);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "offline");
  }
  if (res.status === 204) return null as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !quiet401 && typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    const msg = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const getStatus = () => call<CloudStatus>("/api/v1/cloud/status");

export const listChats = (since?: string) =>
  call<{ chats: ChatListItem[]; now: string }>(`/api/v1/cloud/chats${since ? `?since=${encodeURIComponent(since)}` : ""}`);

/** One chat. A deleted chat (tombstone: chat null) is answered as 404, like a chat that was never synced. */
export async function getChat(chatId: string, signal?: AbortSignal): Promise<{ chatId: string; version: number; chat: Chat }> {
  const r = await call<{ chatId: string; version: number; deleted?: boolean; chat: Chat | null }>(`/api/v1/cloud/chats/${encodeURIComponent(chatId)}`, { signal });
  if (!r?.chat || r.deleted) throw new ApiError(404, "deleted", { code: "not_found" });
  return { chatId: r.chatId, version: r.version, chat: r.chat };
}

export const postJob = (chatId: string, job: JobPayload) =>
  call<{ jobId: string }>("/api/v1/cloud/jobs", { method: "POST", json: { chatId, kind: job.kind, payload: job.payload } });

export type ChatEvent = { changed: boolean; version: number; deleted: boolean; jobs: JobInfo[]; now: string | null };

/**
 * Waits (long-poll, up to 25 s on the server) until the chat's version is above `after` or one of its jobs changed
 * after `jobsAfter`. Answers the version and the chat's jobs of the last 10 minutes (GET /api/v1/cloud/events).
 */
export async function waitForChat(chatId: string, after: number, jobsAfter: string | null, signal: AbortSignal): Promise<ChatEvent> {
  const q = `chatId=${encodeURIComponent(chatId)}&after=${after}${jobsAfter ? `&jobsAfter=${encodeURIComponent(jobsAfter)}` : ""}`;
  const r = await call<Partial<ChatEvent> | null>(`/api/v1/cloud/events?${q}`, { signal });
  return {
    changed: r?.changed === true || (typeof r?.version === "number" && r.version > after),
    version: typeof r?.version === "number" ? r.version : after,
    deleted: r?.deleted === true,
    jobs: Array.isArray(r?.jobs) ? r.jobs.filter((j): j is JobInfo => !!j && typeof j.jobId === "string" && typeof j.status === "string") : [],
    now: typeof r?.now === "string" ? r.now : null,
  };
}

export const getSetup = () => call<{ version: number; items: Record<string, unknown> | null }>("/api/v1/setup");

export const getCredits = () => call<Credits>("/api/v1/ai/status");

export async function getMe(): Promise<Me | null> {
  try {
    const r = await call<{ user: Me }>("/api/v1/me", { quiet401: true });
    return r?.user ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** A voice note to text (the website's speech service, billed in theOovi credits). */
export async function transcribe(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const r = await call<{ text: string }>("/api/v1/ai/transcribe", { method: "POST", json: { audio: btoa(bin), mime: blob.type || "audio/mp4" } });
  return String(r?.text ?? "").trim();
}

// ---------- connectors: the account's vault, sign-ins and the catalog ----------

export const listVault = () =>
  call<{ items: { connectorId: string; version: number; updatedAt: string }[]; pending: PendingSignIn[] }>("/api/v1/cloud/vault");

/** One connector's full entry: held in memory only to change it, never stored on the phone. */
export const getVault = (id: string) => call<{ connectorId: string; version: number; data: VaultItem }>(`/api/v1/cloud/vault/${encodeURIComponent(id)}`);

export const putVault = (id: string, baseVersion: number, data: VaultItem) =>
  call<{ version: number }>(`/api/v1/cloud/vault/${encodeURIComponent(id)}`, { method: "PUT", json: { baseVersion, data } });

export const deleteVault = (id: string) => call<{ ok: true }>(`/api/v1/cloud/vault/${encodeURIComponent(id)}`, { method: "DELETE" });

export const startSignIn = (id: string, url?: string) =>
  call<{ authUrl: string; flowId: string }>(`/api/v1/cloud/connectors/${encodeURIComponent(id)}/oauth/start`, { method: "POST", json: url ? { url } : {} });

export const finishSignIn = (flowId: string) =>
  call<{ connectorId: string; version: number; data: VaultItem }>("/api/v1/cloud/connectors/oauth/finish", { method: "POST", json: { flowId } });

/** The website's published Marketplace items (public). */
export const getCatalog = () => call<{ items: unknown[]; hidden: string[] }>("/api/v1/catalog");

/**
 * Changes a connector: reads its current entry, applies `change`, saves it. On a conflict (changed elsewhere in
 * between) it reads again and applies the change once more.
 */
export async function changeVault(id: string, change: (d: VaultItem) => VaultItem): Promise<{ version: number; data: VaultItem }> {
  for (let i = 0; i < 2; i++) {
    const cur = await getVault(id);
    const next = change(cur.data);
    try {
      const r = await putVault(id, cur.version, next);
      return { version: r.version, data: next };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409) || i === 1) throw err;
    }
  }
  throw new ApiError(409, "conflict");
}

// ---------- adding bots and groups (the account's setup, as the desktop's setup sync keeps it) ----------

export const putSetup = (baseVersion: number, items: Record<string, unknown>) =>
  call<{ version: number }>("/api/v1/setup", { method: "PUT", json: { baseVersion, items } });

/**
 * Changes the account's setup (adds a bot "bot:<id>" or a group "group:<id>", removes a group): reads it, applies
 * `change`, saves it. When a computer saved in between (409) it reads again and applies the change once more. The
 * computer follows at its next setup sync (a few minutes).
 */
export async function changeSetup(change: (items: Record<string, unknown>) => Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let i = 0; i < 3; i++) {
    const cur = await getSetup();
    const items = change({ ...(cur?.items ?? {}) });
    try {
      await putSetup(cur?.version ?? 0, items);
      return items;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409) || i === 2) throw err;
    }
  }
  throw new ApiError(409, "conflict");
}

export const addToSetup = (add: Record<string, unknown>) => changeSetup((items) => ({ ...items, ...add }));

export const removeFromSetup = (keys: string[]) =>
  changeSetup((items) => {
    for (const k of keys) delete items[k];
    return items;
  });

/** Deletes a chat on every device (kept 30 days as a tombstone so the others remove it too). */
export const deleteChat = (chatId: string) => call<{ version: number }>(`/api/v1/cloud/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
