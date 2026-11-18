// oovi cloud, the database side (docs/CLOUD-BUILD.md): optional chat sync, connector sign-ins (the vault),
// jobs the phone sends to the desktop app or the cloud runner, and the devices of each account.
//
// Every function takes the account id from the caller (a signed-in session, or the runner's address after its
// secret was checked), never from a request body. Chats, vault items and job payloads are stored compressed and
// encrypted (gzip + sealSecret, the box of lib/ai-config.ts whose key lives in the website's environment, never
// in the database), like account_setup. Nothing here logs content. Tables are created on first use and in
// scripts/migrate.mjs (keep both in step).
import crypto from "node:crypto";
import zlib from "node:zlib";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";
import {
  ACCOUNT_LIMIT_BYTES,
  LEASE_SECONDS,
  MAX_CHATS,
  MAX_DEVICES,
  MAX_OPEN_JOBS,
  MAX_VAULT_ITEMS,
  ONLINE_SECONDS,
  RUNNER_DELAY_SECONDS,
  TOMBSTONE_DAYS,
  quotaAfter,
  type DoneStatusCore,
  type JobKindCore,
} from "./cloud-core";
import type { ChatListItem, ClaimedJob, CloudDevice, CloudStatus, DeviceKind, JobInfo, RunnerClaimedJob } from "./cloud-types";

export const CLOUD_DDL = `
  CREATE TABLE IF NOT EXISTS cloud_sync (
    user_id     TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    enabled     BOOLEAN NOT NULL DEFAULT false,
    bytes       INTEGER NOT NULL DEFAULT 0,
    chats       INTEGER NOT NULL DEFAULT 0,
    last_sync   TIMESTAMPTZ NULL,
    enabled_at  TIMESTAMPTZ NULL,
    disabled_at TIMESTAMPTZ NULL
  );
  CREATE TABLE IF NOT EXISTS cloud_chat (
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    chat_id    TEXT NOT NULL,
    version    INTEGER NOT NULL,
    data       JSONB NULL,
    bytes      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted    BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS cloud_chat_updated_idx ON cloud_chat (user_id, updated_at);
  CREATE TABLE IF NOT EXISTS cloud_vault (
    user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    connector_id TEXT NOT NULL,
    version      INTEGER NOT NULL,
    data         JSONB NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, connector_id)
  );
  CREATE TABLE IF NOT EXISTS cloud_job (
    id          UUID PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    chat_id     TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('message', 'decision', 'stop')),
    payload     JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'done', 'needs_computer', 'failed')),
    claimed_by  TEXT NULL,
    lease_until TIMESTAMPTZ NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    error       TEXT NULL
  );
  CREATE INDEX IF NOT EXISTS cloud_job_open_idx ON cloud_job (created_at) WHERE status IN ('queued', 'needs_computer', 'claimed');
  CREATE INDEX IF NOT EXISTS cloud_job_chat_idx ON cloud_job (user_id, chat_id, updated_at);
  CREATE TABLE IF NOT EXISTS cloud_device (
    user_id   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    kind      TEXT NOT NULL CHECK (kind IN ('desktop', 'phone', 'runner')),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, device_id)
  );
  CREATE TABLE IF NOT EXISTS cloud_oauth_flow (
    state_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    data         JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS cloud_oauth_flow_user_idx ON cloud_oauth_flow (user_id);
`;

const g = globalThis as typeof globalThis & { __ooviCloudTables?: Promise<void> };
export function ensureCloudTables(): Promise<void> {
  g.__ooviCloudTables ??= pool.query(CLOUD_DDL).then(
    () => undefined,
    (err: unknown) => {
      g.__ooviCloudTables = undefined;
      throw err;
    },
  );
  return g.__ooviCloudTables;
}

// ---------- sealing ----------

/** JSON → gzip → encrypted. bytes = the compressed size (what counts against the account's limit). */
export function sealJson(value: unknown): { sealed: Sealed; bytes: number } {
  const gz = zlib.gzipSync(JSON.stringify(value));
  return { sealed: sealSecret(gz.toString("base64")), bytes: gz.length };
}
export function unsealJson<T = Record<string, unknown>>(sealed: unknown): T {
  return JSON.parse(zlib.gunzipSync(Buffer.from(unsealSecret(sealed as Sealed), "base64")).toString("utf8")) as T;
}

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureCloudTables();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

// ---------- status and devices ----------

export async function getStatus(userId: string): Promise<CloudStatus> {
  await ensureCloudTables();
  const [s, d] = await Promise.all([
    pool.query("SELECT enabled, bytes, chats, last_sync FROM cloud_sync WHERE user_id = $1", [userId]),
    pool.query(
      `SELECT device_id, kind, last_seen, last_seen > now() - make_interval(secs => $2) AS online
         FROM cloud_device WHERE user_id = $1 ORDER BY last_seen DESC LIMIT ${MAX_DEVICES}`,
      [userId, ONLINE_SECONDS],
    ),
  ]);
  const row = s.rows[0];
  const devices: CloudDevice[] = d.rows.map((r) => ({ deviceId: r.device_id, kind: r.kind as DeviceKind, lastSeen: iso(r.last_seen)!, online: !!r.online }));
  return {
    enabled: !!row?.enabled,
    bytes: Number(row?.bytes ?? 0),
    limit: ACCOUNT_LIMIT_BYTES,
    chats: Number(row?.chats ?? 0),
    lastSync: iso(row?.last_sync ?? null),
    devices,
  };
}

/**
 * Turns sync on or off. Off deletes, at once, every chat, vault item and job of the account on the server
 * (the computer keeps its own copy). Devices stay (no content: an id, a kind, a time).
 */
export async function setEnabled(userId: string, enabled: boolean): Promise<void> {
  await tx(async (c) => {
    if (enabled) {
      await c.query(
        `INSERT INTO cloud_sync (user_id, enabled, enabled_at) VALUES ($1, true, now())
         ON CONFLICT (user_id) DO UPDATE SET enabled = true,
           enabled_at = CASE WHEN cloud_sync.enabled THEN cloud_sync.enabled_at ELSE now() END`,
        [userId],
      );
      return;
    }
    await c.query(
      `INSERT INTO cloud_sync (user_id, enabled, disabled_at) VALUES ($1, false, now())
       ON CONFLICT (user_id) DO UPDATE SET enabled = false, bytes = 0, chats = 0, disabled_at = now()`,
      [userId],
    );
    await c.query("DELETE FROM cloud_chat WHERE user_id = $1", [userId]);
    await c.query("DELETE FROM cloud_vault WHERE user_id = $1", [userId]);
    await c.query("DELETE FROM cloud_job WHERE user_id = $1", [userId]);
    await c.query("DELETE FROM cloud_oauth_flow WHERE user_id = $1", [userId]);
  });
}

export async function isEnabled(userId: string): Promise<boolean> {
  await ensureCloudTables();
  const { rows } = await pool.query("SELECT enabled FROM cloud_sync WHERE user_id = $1", [userId]);
  return !!rows[0]?.enabled;
}

/** Marks a device seen (at most every 10 s), up to MAX_DEVICES per account; devices unseen for 90 days go. */
export async function touchDevice(userId: string, kind: DeviceKind, deviceId: string): Promise<void> {
  await ensureCloudTables();
  const up = await pool.query(
    "UPDATE cloud_device SET last_seen = now(), kind = $3 WHERE user_id = $1 AND device_id = $2 AND (last_seen < now() - interval '10 seconds' OR kind <> $3)",
    [userId, deviceId, kind],
  );
  if (up.rowCount) return;
  const seen = await pool.query("SELECT 1 FROM cloud_device WHERE user_id = $1 AND device_id = $2", [userId, deviceId]);
  if (seen.rowCount) return;
  await pool.query("DELETE FROM cloud_device WHERE user_id = $1 AND last_seen < now() - interval '90 days'", [userId]);
  await pool.query(
    `INSERT INTO cloud_device (user_id, device_id, kind, last_seen)
     SELECT $1, $2, $3, now() WHERE (SELECT count(*) FROM cloud_device WHERE user_id = $1) < ${MAX_DEVICES}
     ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen = now()`,
    [userId, deviceId, kind],
  );
}

// ---------- chats ----------

export type Off = { off: true };
const OFF: Off = { off: true };

/** Chats changed after `since` (all when null), tombstones included. Tombstones older than 30 days are removed first. */
export async function listChats(userId: string, since: Date | null): Promise<{ chats: ChatListItem[]; now: string } | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  await pool.query(`DELETE FROM cloud_chat WHERE user_id = $1 AND deleted AND updated_at < now() - interval '${TOMBSTONE_DAYS} days'`, [userId]);
  // `now` is a few seconds early: a save that started before this read but finished after it is listed again next
  // time instead of being missed (clients compare versions, so a repeat costs nothing).
  const { rows } = await pool.query(
    `SELECT chat_id, version, updated_at, deleted, bytes, (now() - interval '5 seconds') AS next
       FROM cloud_chat WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at > $2) ORDER BY updated_at LIMIT ${MAX_CHATS}`,
    [userId, since],
  );
  const next = rows[0]?.next ?? (await pool.query("SELECT now() - interval '5 seconds' AS next")).rows[0].next;
  return {
    chats: rows.map((r) => ({ chatId: r.chat_id, version: Number(r.version), updatedAt: iso(r.updated_at)!, deleted: !!r.deleted, bytes: Number(r.bytes) })),
    now: iso(next)!,
  };
}

export type ChatRow = { chatId: string; version: number; deleted: boolean; chat: Record<string, unknown> | null };

export async function getChat(userId: string, chatId: string): Promise<ChatRow | null | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  const { rows } = await pool.query("SELECT version, deleted, data FROM cloud_chat WHERE user_id = $1 AND chat_id = $2", [userId, chatId]);
  const r = rows[0];
  if (!r) return null;
  return { chatId, version: Number(r.version), deleted: !!r.deleted, chat: r.deleted || !r.data ? null : unsealJson(r.data) };
}

export type PutResult =
  | { ok: true; version: number }
  | { conflict: true; version: number; deleted: boolean; chat: Record<string, unknown> | null }
  | { over: true; bytes: number; limit: number }
  | Off;

/** Saves when baseVersion is the server's version (0 = new chat); else the server's copy comes back to merge. */
export async function putChat(userId: string, chatId: string, baseVersion: number, chat: Record<string, unknown>): Promise<PutResult> {
  const { sealed, bytes } = sealJson(chat);
  return tx(async (c) => {
    const s = (await c.query("SELECT enabled, bytes, chats FROM cloud_sync WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!s?.enabled) return OFF;
    const row = (await c.query("SELECT version, bytes, deleted, data FROM cloud_chat WHERE user_id = $1 AND chat_id = $2 FOR UPDATE", [userId, chatId])).rows[0];
    const current = row ? Number(row.version) : 0;
    if (baseVersion !== current) {
      return { conflict: true, version: current, deleted: !!row?.deleted, chat: row && !row.deleted && row.data ? unsealJson(row.data) : null };
    }
    const live = !!row && !row.deleted;
    if (!live && Number(s.chats) >= MAX_CHATS) return { over: true, bytes: Number(s.bytes), limit: ACCOUNT_LIMIT_BYTES };
    const total = quotaAfter(Number(s.bytes), live ? Number(row.bytes) : 0, bytes);
    if (total === "over") return { over: true, bytes: Number(s.bytes), limit: ACCOUNT_LIMIT_BYTES };
    const next = current + 1;
    await c.query(
      `INSERT INTO cloud_chat (user_id, chat_id, version, data, bytes, updated_at, deleted) VALUES ($1, $2, $3, $4, $5, now(), false)
       ON CONFLICT (user_id, chat_id) DO UPDATE SET version = $3, data = $4, bytes = $5, updated_at = now(), deleted = false`,
      [userId, chatId, next, sealed, bytes],
    );
    await c.query("UPDATE cloud_sync SET bytes = $2, chats = chats + $3, last_sync = now() WHERE user_id = $1", [userId, total, live ? 0 : 1]);
    return { ok: true, version: next };
  });
}

/** Marks a chat deleted: its content goes at once, a tombstone stays 30 days so other devices remove it too. Its waiting jobs go. */
export async function deleteChat(userId: string, chatId: string): Promise<{ version: number } | null | Off> {
  return tx(async (c) => {
    const s = (await c.query("SELECT enabled FROM cloud_sync WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!s?.enabled) return OFF;
    const row = (await c.query("SELECT version, bytes, deleted FROM cloud_chat WHERE user_id = $1 AND chat_id = $2 FOR UPDATE", [userId, chatId])).rows[0];
    if (!row) return null;
    if (row.deleted) return { version: Number(row.version) };
    const next = Number(row.version) + 1;
    await c.query("UPDATE cloud_chat SET version = $3, data = NULL, bytes = 0, deleted = true, updated_at = now() WHERE user_id = $1 AND chat_id = $2", [userId, chatId, next]);
    await c.query("UPDATE cloud_sync SET bytes = GREATEST(0, bytes - $2), chats = GREATEST(0, chats - 1), last_sync = now() WHERE user_id = $1", [userId, Number(row.bytes)]);
    await c.query("DELETE FROM cloud_job WHERE user_id = $1 AND chat_id = $2 AND status IN ('queued', 'needs_computer')", [userId, chatId]);
    return { version: next };
  });
}

// ---------- vault (a connector's settings and sign-in) ----------

export async function listVault(userId: string): Promise<{ connectorId: string; version: number; updatedAt: string }[] | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  const { rows } = await pool.query("SELECT connector_id, version, updated_at FROM cloud_vault WHERE user_id = $1 ORDER BY connector_id", [userId]);
  return rows.map((r) => ({ connectorId: r.connector_id, version: Number(r.version), updatedAt: iso(r.updated_at)! }));
}

export async function getVault(userId: string, connectorId: string): Promise<{ version: number; data: Record<string, unknown> } | null | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  const { rows } = await pool.query("SELECT version, data FROM cloud_vault WHERE user_id = $1 AND connector_id = $2", [userId, connectorId]);
  return rows[0] ? { version: Number(rows[0].version), data: unsealJson(rows[0].data) } : null;
}

export type VaultPutResult = { ok: true; version: number } | { conflict: true; version: number; data: Record<string, unknown> | null } | { full: true } | Off;

export async function putVault(userId: string, connectorId: string, baseVersion: number, data: Record<string, unknown>): Promise<VaultPutResult> {
  const { sealed } = sealJson(data);
  return tx(async (c) => {
    const s = (await c.query("SELECT enabled FROM cloud_sync WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!s?.enabled) return OFF;
    const row = (await c.query("SELECT version, data FROM cloud_vault WHERE user_id = $1 AND connector_id = $2 FOR UPDATE", [userId, connectorId])).rows[0];
    const current = row ? Number(row.version) : 0;
    if (baseVersion !== current) return { conflict: true, version: current, data: row ? unsealJson(row.data) : null };
    if (!row) {
      const n = Number((await c.query("SELECT count(*) AS n FROM cloud_vault WHERE user_id = $1", [userId])).rows[0].n);
      if (n >= MAX_VAULT_ITEMS) return { full: true };
    }
    await c.query(
      `INSERT INTO cloud_vault (user_id, connector_id, version, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, connector_id) DO UPDATE SET version = $3, data = $4, updated_at = now()`,
      [userId, connectorId, current + 1, sealed],
    );
    await c.query("UPDATE cloud_sync SET last_sync = now() WHERE user_id = $1", [userId]);
    return { ok: true, version: current + 1 };
  });
}

/**
 * A sign-in finished on the website (lib/cloud-oauth.ts): the tokens go into the connector's vault entry under
 * `oauth`, the rest of its settings untouched, with a new version (other devices pull it).
 */
export async function saveVaultSignIn(userId: string, connectorId: string, url: string, oauth: Record<string, unknown>): Promise<{ version: number } | Off> {
  return tx(async (c) => {
    const s = (await c.query("SELECT enabled FROM cloud_sync WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!s?.enabled) return OFF;
    const row = (await c.query("SELECT version, data FROM cloud_vault WHERE user_id = $1 AND connector_id = $2 FOR UPDATE", [userId, connectorId])).rows[0];
    const data = { ...(row ? unsealJson(row.data) : { url }), oauth };
    const next = (row ? Number(row.version) : 0) + 1;
    await c.query(
      `INSERT INTO cloud_vault (user_id, connector_id, version, data, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, connector_id) DO UPDATE SET version = $3, data = $4, updated_at = now()`,
      [userId, connectorId, next, sealJson(data).sealed],
    );
    await c.query("UPDATE cloud_sync SET last_sync = now() WHERE user_id = $1", [userId]);
    return { version: next };
  });
}

/** A connector removed on a computer: its sign-in leaves the server at once (no tombstone: the list shows it's gone). */
export async function deleteVault(userId: string, connectorId: string): Promise<boolean | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  const r = await pool.query("DELETE FROM cloud_vault WHERE user_id = $1 AND connector_id = $2", [userId, connectorId]);
  return !!r.rowCount;
}

// ---------- jobs ----------

export type CreateJobResult = { jobId: string } | { noChat: true } | { tooMany: true } | Off;

/** The phone sends a message, an approval answer or Stop for a synced chat. */
export async function createJob(userId: string, chatId: string, kind: JobKindCore, payload: Record<string, unknown>): Promise<CreateJobResult> {
  const { sealed } = sealJson(payload);
  return tx(async (c) => {
    const s = (await c.query("SELECT enabled FROM cloud_sync WHERE user_id = $1 FOR UPDATE", [userId])).rows[0];
    if (!s?.enabled) return OFF;
    const chat = (await c.query("SELECT deleted FROM cloud_chat WHERE user_id = $1 AND chat_id = $2", [userId, chatId])).rows[0];
    if (!chat || chat.deleted) return { noChat: true };
    // Finished jobs keep no content (cleared at done); their rows go after a day.
    await c.query("DELETE FROM cloud_job WHERE user_id = $1 AND status IN ('done', 'failed') AND updated_at < now() - interval '1 day'", [userId]);
    const open = Number((await c.query("SELECT count(*) AS n FROM cloud_job WHERE user_id = $1 AND status IN ('queued', 'needs_computer', 'claimed')", [userId])).rows[0].n);
    if (open >= MAX_OPEN_JOBS) return { tooMany: true };
    const id = crypto.randomUUID();
    await c.query("INSERT INTO cloud_job (id, user_id, chat_id, kind, payload) VALUES ($1, $2, $3, $4, $5)", [id, userId, chatId, kind, sealed]);
    return { jobId: id };
  });
}

type JobRow = { id: string; user_id: string; chat_id: string; kind: string; status: string; payload: unknown; created_at: Date; lease_until: Date };

/**
 * Claims the oldest job matching `where` (one chat, one runner at a time). Candidates are locked with
 * FOR UPDATE SKIP LOCKED, so two claimers never get the same job; a chat whose job another claimer holds
 * (lease not ended) is skipped, and a per-chat advisory lock closes the race between two jobs of one chat.
 * "stop" jobs reach the claimer that already holds the chat.
 */
async function claim(by: string, where: string, params: unknown[]): Promise<JobRow & { was: string } | null> {
  return tx(async (c) => {
    const skipped: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = params.length;
      const cand = (
        await c.query(
          `SELECT j.id, j.user_id, j.chat_id, j.status FROM cloud_job j
            WHERE (j.status IN ('queued', 'needs_computer') OR (j.status = 'claimed' AND j.lease_until < now()))
              AND ${where}
              AND NOT (j.id = ANY($${p + 1}::uuid[]))
              AND NOT EXISTS (SELECT 1 FROM cloud_job o WHERE o.user_id = j.user_id AND o.chat_id = j.chat_id AND o.id <> j.id
                                AND o.status = 'claimed' AND o.lease_until > now() AND o.claimed_by <> $${p + 2})
            ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
          [...params, skipped, by],
        )
      ).rows[0] as { id: string; user_id: string; chat_id: string; status: string } | undefined;
      if (!cand) return null;
      const lock = await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok", [`oovi-cloud-chat:${cand.user_id}:${cand.chat_id}`]);
      const busy =
        !lock.rows[0].ok ||
        (
          await c.query(
            "SELECT 1 FROM cloud_job WHERE user_id = $1 AND chat_id = $2 AND id <> $3 AND status = 'claimed' AND lease_until > now() AND claimed_by <> $4 LIMIT 1",
            [cand.user_id, cand.chat_id, cand.id, by],
          )
        ).rowCount;
      if (busy) {
        skipped.push(cand.id);
        continue;
      }
      const { rows } = await c.query(
        `UPDATE cloud_job SET status = 'claimed', claimed_by = $2, lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
          WHERE id = $1 RETURNING id, user_id, chat_id, kind, status, payload, created_at, lease_until`,
        [cand.id, by],
      );
      return { ...(rows[0] as JobRow), was: cand.status };
    }
    return null;
  });
}

function toClaimed(r: JobRow & { was: string }): ClaimedJob {
  return {
    jobId: r.id,
    chatId: r.chat_id,
    kind: r.kind as ClaimedJob["kind"],
    payload: unsealJson(r.payload),
    was: r.was as ClaimedJob["was"],
    createdAt: iso(r.created_at)!,
    leaseUntil: iso(r.lease_until)!,
  };
}

/** The desktop app (open, signed in) claims its account's jobs, including those the runner left for the computer. */
export async function claimForDesktop(userId: string, deviceId: string, chatIds: string[] | null): Promise<ClaimedJob | null | Off> {
  await ensureCloudTables();
  if (!(await isEnabled(userId))) return OFF;
  await touchDevice(userId, "desktop", deviceId);
  const r = await claim(`desktop:${deviceId}`, "j.user_id = $1 AND ($2::text[] IS NULL OR j.chat_id = ANY($2::text[]))", [userId, chatIds]);
  return r ? toClaimed(r) : null;
}

/**
 * The cloud runner claims a job of any account that syncs: only jobs that waited RUNNER_DELAY_SECONDS with no
 * desktop of that account online, never one left for the computer (needs_computer).
 */
export async function claimForRunner(runnerId: string): Promise<RunnerClaimedJob | null> {
  await ensureCloudTables();
  if (Math.random() < 0.02) {
    await pool.query("DELETE FROM cloud_job WHERE status IN ('done', 'failed') AND updated_at < now() - interval '1 day'").catch(() => {});
  }
  const r = await claim(
    `runner:${runnerId}`,
    `j.status <> 'needs_computer'
     AND j.created_at < now() - make_interval(secs => ${RUNNER_DELAY_SECONDS})
     AND EXISTS (SELECT 1 FROM cloud_sync s WHERE s.user_id = j.user_id AND s.enabled)
     AND NOT EXISTS (SELECT 1 FROM cloud_device d WHERE d.user_id = j.user_id AND d.kind = 'desktop' AND d.last_seen > now() - make_interval(secs => ${ONLINE_SECONDS}))`,
    [],
  );
  if (!r) return null;
  await touchDevice(r.user_id, "runner", runnerId).catch(() => {});
  return { ...toClaimed(r), userId: r.user_id };
}

/** Extends the lease of a job this claimer holds. null = the lease was lost (another claimer took it, or it ended). */
export async function heartbeat(jobId: string, by: string, userId: string | null): Promise<string | null> {
  await ensureCloudTables();
  const { rows } = await pool.query(
    `UPDATE cloud_job SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
      WHERE id = $1 AND claimed_by = $2 AND status = 'claimed' AND ($3::text IS NULL OR user_id = $3) RETURNING lease_until`,
    [jobId, by, userId],
  );
  return rows[0] ? iso(rows[0].lease_until) : null;
}

/** Ends a claim. done/failed clear the payload; needs_computer puts the job back for the desktop. */
export async function finishJob(jobId: string, by: string, userId: string | null, status: DoneStatusCore, error: string | null): Promise<boolean> {
  await ensureCloudTables();
  const r = await pool.query(
    `UPDATE cloud_job SET status = $4, error = $5, updated_at = now(), lease_until = NULL,
            claimed_by = CASE WHEN $4 = 'needs_computer' THEN NULL ELSE claimed_by END,
            payload = CASE WHEN $4 = 'needs_computer' THEN payload ELSE '{}'::jsonb END
      WHERE id = $1 AND claimed_by = $2 AND status = 'claimed' AND ($3::text IS NULL OR user_id = $3)`,
    [jobId, by, userId, status, error],
  );
  return !!r.rowCount;
}

// ---------- events (long-poll) ----------

export async function chatEvent(
  userId: string,
  chatId: string,
  jobsAfter: Date | null,
): Promise<{ version: number; deleted: boolean; updatedAt: string | null; jobs: JobInfo[]; jobsChanged: boolean }> {
  await ensureCloudTables();
  const [chat, jobs] = await Promise.all([
    pool.query("SELECT version, deleted, updated_at FROM cloud_chat WHERE user_id = $1 AND chat_id = $2", [userId, chatId]),
    pool.query(
      `SELECT id, kind, status, error, updated_at FROM cloud_job
        WHERE user_id = $1 AND chat_id = $2 AND updated_at > now() - interval '10 minutes' ORDER BY updated_at DESC LIMIT 20`,
      [userId, chatId],
    ),
  ]);
  const r = chat.rows[0];
  const list: JobInfo[] = jobs.rows.map((j) => ({ jobId: j.id, kind: j.kind, status: j.status, error: j.error ?? null, updatedAt: iso(j.updated_at)! }));
  return {
    version: r ? Number(r.version) : 0,
    deleted: !!r?.deleted,
    updatedAt: iso(r?.updated_at ?? null),
    jobs: list,
    jobsChanged: !!jobsAfter && jobs.rows.some((j) => new Date(j.updated_at).getTime() > jobsAfter.getTime()),
  };
}

// ---------- admin (counts and sizes only, never content) ----------

export type CloudSummary = { enabled: boolean; chats: number; bytes: number; lastSync: string | null; devices: number };

/** Per account, for Admin > Users. Null when the tables can't be read (the page still works). */
export async function cloudSummaries(userIds: string[]): Promise<Map<string, CloudSummary> | null> {
  if (!userIds.length) return new Map();
  try {
    await ensureCloudTables();
    const { rows } = await pool.query(
      `SELECT s.user_id, s.enabled, s.chats, s.bytes, s.last_sync,
              (SELECT count(*) FROM cloud_device d WHERE d.user_id = s.user_id) AS devices
         FROM cloud_sync s WHERE s.user_id = ANY($1::text[])`,
      [userIds],
    );
    return new Map(rows.map((r) => [r.user_id as string, { enabled: !!r.enabled, chats: Number(r.chats), bytes: Number(r.bytes), lastSync: iso(r.last_sync), devices: Number(r.devices) }]));
  } catch {
    return null;
  }
}

/** For Admin > Overview. */
export async function cloudOverview(): Promise<{ syncing: number; chats: number; bytes: number } | null> {
  try {
    await ensureCloudTables();
    const { rows } = await pool.query("SELECT count(*) FILTER (WHERE enabled) AS n, COALESCE(sum(chats), 0) AS chats, COALESCE(sum(bytes), 0) AS bytes FROM cloud_sync");
    return { syncing: Number(rows[0].n), chats: Number(rows[0].chats), bytes: Number(rows[0].bytes) };
  } catch {
    return null;
  }
}
