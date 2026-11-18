"use client";

// Calls from the phone app to the website (same origin, the website's session cookie; no key is ever sent or
// kept here). The cloud API is the contract in docs/CLOUD-BUILD.md (/api/v1/cloud); bots and connectors come
// from the account's setup (/api/v1/setup), credits from /api/v1/ai/status, voice notes from /api/v1/ai/transcribe.
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
