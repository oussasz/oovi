// oovi cloud: the request and response shapes of /api/v1/cloud (docs/CLOUD-BUILD.md). Written by part W
// (website); the desktop app, the phone app and the runner COPY what they need (no imports across the
// app/web boundary). Types only: nothing here runs.

export type DeviceKind = "desktop" | "phone" | "runner";
export type JobKind = "message" | "decision" | "stop";
export type JobStatus = "queued" | "claimed" | "done" | "needs_computer" | "failed";

/** Optional header on every signed-in cloud request: "<kind>:<deviceId>", e.g. "phone:7f3a…". Marks the device seen. */
export const DEVICE_HEADER = "x-oovi-device";
/** Header of the runner-only API (/api/v1/cloud/runner/...): the website's RUNNER_SECRET. */
export const RUNNER_HEADER = "x-oovi-runner";

/** Any error: `code` is stable, `error` is a sentence for people. */
export type CloudError = {
  error: string;
  code: "signed_out" | "blocked" | "bad_request" | "sync_off" | "not_found" | "conflict" | "over_limit" | "too_big" | "busy" | "unavailable" | "runner_off" | "forbidden";
};

// ---- GET/PUT /status ----
export type CloudDevice = { deviceId: string; kind: DeviceKind; lastSeen: string; online: boolean };
export type CloudStatus = {
  enabled: boolean;
  /** Compressed bytes of the account's chats on the server. */
  bytes: number;
  /** The account's limit in bytes (100 MB). */
  limit: number;
  chats: number;
  lastSync: string | null;
  devices: CloudDevice[];
};
export type PutStatusRequest = { enabled: boolean };
export type PutStatusResponse = CloudStatus;

// ---- chats ----
/** GET /chats?since=<iso>: only rows changed after `since` (tombstones included). `now` is the next `since`. */
export type ChatListItem = { chatId: string; version: number; updatedAt: string; deleted: boolean; bytes: number };
export type ChatListResponse = { chats: ChatListItem[]; now: string };
/** GET /chats/<chatId>. `chat` is null for a deleted chat (tombstone). */
export type ChatGetResponse = { chatId: string; version: number; deleted: boolean; chat: Record<string, unknown> | null };
/** PUT /chats/<chatId>. baseVersion 0 = a chat the server doesn't have yet. */
export type ChatPutRequest = { baseVersion: number; chat: Record<string, unknown> };
export type ChatPutResponse = { version: number };
/** 409 on PUT: the server's copy. Merge (entries by id, newer updatedAt wins), then PUT with baseVersion = version. */
export type ChatConflict = CloudError & { version: number; deleted: boolean; chat: Record<string, unknown> | null };
/** 413 on PUT when the account would go over its limit (code over_limit), or the chat alone is too big (code too_big). */
export type ChatTooBig = CloudError & { bytes: number; limit: number };
export type ChatDeleteResponse = { version: number };

// ---- vault (a connector's settings and sign-in; never AI keys) ----
export type VaultListResponse = { items: { connectorId: string; version: number; updatedAt: string }[] };
export type VaultGetResponse = { connectorId: string; version: number; data: Record<string, unknown> };
export type VaultPutRequest = { baseVersion: number; data: Record<string, unknown> };
export type VaultPutResponse = { version: number };
export type VaultConflict = CloudError & { version: number; data: Record<string, unknown> | null };

/**
 * A vault entry's data is the app's to shape, with two fields the website itself reads or writes:
 * `url` (the connector's address, used to start a sign-in from the phone) and `oauth` (written by the sign-in
 * callback: {clientInfo, tokens, redirectUrl, signedInAt}, the desktop's OAuthData shape; the client was registered
 * for the website's redirect address, so refreshing uses clientInfo as it is). A connector's own key is allowed;
 * an AI model key is refused (400).
 */
export type VaultData = Record<string, unknown> & { url?: string; oauth?: Record<string, unknown> };

// ---- connectors signed in from the phone ----
/** POST /connectors/<connectorId>/oauth/start {url?} → {authUrl}: open it in the same browser (the session must match). */
export type OAuthStartRequest = { url?: string };
export type OAuthStartResponse = { authUrl: string };
/**
 * GET /connectors/oauth/callback (the service sends the browser here) → 303 to /m/connectors?connected=<id>,
 * or /m/connectors?error=expired|denied|failed|signed_out|sync_off[&id=<id>].
 */
export type OAuthReturnError = "expired" | "denied" | "failed" | "signed_out" | "sync_off";

// ---- jobs ----
export type JobCreateRequest = { chatId: string; kind: JobKind; payload: Record<string, unknown> };
export type JobCreateResponse = { jobId: string };
/** POST /jobs/claim (desktop; a phone never claims). chatIds limits the claim to these chats. */
export type JobClaimRequest = { deviceId: string; kind: "desktop"; chatIds?: string[] };
export type ClaimedJob = {
  jobId: string;
  chatId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  /** The status it had before this claim: "needs_computer" = the runner could not do it. */
  was: "queued" | "needs_computer" | "claimed";
  createdAt: string;
  leaseUntil: string;
};
export type JobClaimResponse = { job: ClaimedJob | null };
/** POST /jobs/<id>/heartbeat {deviceId}: extends the lease by 120 s. 409 when the lease was lost. */
export type JobHeartbeatRequest = { deviceId: string };
export type JobHeartbeatResponse = { leaseUntil: string };
/** POST /jobs/<id>/done. needs_computer puts it back for the desktop. */
export type JobDoneRequest = { deviceId: string; status: "done" | "failed" | "needs_computer"; error?: string };
export type JobDoneResponse = { ok: true };
export type JobInfo = { jobId: string; kind: JobKind; status: JobStatus; error: string | null; updatedAt: string };

// ---- GET /events?chatId=…&after=<version>[&jobsAfter=<iso>] (long-poll, up to 25 s) ----
/** changed=false: nothing new in 25 s, ask again. `jobs`: this chat's jobs changed in the last 10 minutes. */
export type EventsResponse = { chatId: string; changed: boolean; version: number; deleted: boolean; updatedAt: string | null; jobs: JobInfo[]; now: string };

// ---- runner-only (header x-oovi-runner) ----
export type RunnerClaimRequest = { runnerId: string };
export type RunnerClaimedJob = ClaimedJob & { userId: string };
export type RunnerClaimResponse = { job: RunnerClaimedJob | null };
export type RunnerJobRequest = { runnerId: string };
export type RunnerDoneRequest = { runnerId: string; status: "done" | "failed" | "needs_computer"; error?: string };
// GET/PUT /runner/chats/<userId>/<chatId>: same bodies as /chats/<chatId>.
// GET/PUT /runner/vault/<userId>/<connectorId>: same bodies as /vault/<connectorId> (PUT for refreshed sign-ins).
// POST /runner/ai/<userId>: same body and answer as /api/v1/ai/messages, billed to that user.
