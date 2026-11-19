// The answers shared by the signed-in routes (/api/v1/cloud/chats, /vault) and the runner's routes
// (/api/v1/cloud/runner/chats, /runner/vault): the account id always comes from the caller, never the body.
import type { NextResponse } from "next/server";
import { MAX_CHAT_TEXT, MAX_VAULT_ITEMS, MAX_VAULT_TEXT, checkChatPut, checkDone, checkVaultPut, isId } from "./cloud-core";
import { finishJob, getChat, getVault, heartbeat, putChat, putVault, routineRan } from "./cloud";
import { body, fail, notFound, ok, syncOff } from "./cloud-route";

export async function chatGet(userId: string, chatId: string): Promise<NextResponse> {
  if (!isId(chatId)) return fail(400, "bad_request", "Invalid chat id.");
  const r = await getChat(userId, chatId);
  if (r && "off" in r) return syncOff();
  if (!r) return notFound();
  return ok(r);
}

export async function chatPut(req: Request, userId: string, chatId: string): Promise<NextResponse> {
  if (!isId(chatId)) return fail(400, "bad_request", "Invalid chat id.");
  const b = await body(req, MAX_CHAT_TEXT + 1024);
  if (b === "too_big") return fail(413, "too_big", "This chat is too big to sync (over 4 MB).", { bytes: 0, limit: MAX_CHAT_TEXT });
  if (b === "bad") return fail(400, "bad_request", "Invalid request.");
  const v = checkChatPut(chatId, b);
  if (typeof v === "string") return fail(400, "bad_request", v);
  const r = await putChat(userId, chatId, v.baseVersion, v.chat);
  if ("off" in r) return syncOff();
  if ("over" in r) return fail(413, "over_limit", "Your cloud space is full. New chats stay on your computer.", { bytes: r.bytes, limit: r.limit });
  if ("conflict" in r) return fail(409, "conflict", "This chat changed on another device. Merge and send it again.", { version: r.version, deleted: r.deleted, chat: r.chat });
  return ok({ version: r.version });
}

export async function vaultGet(userId: string, connectorId: string): Promise<NextResponse> {
  if (!isId(connectorId)) return fail(400, "bad_request", "Invalid connector id.");
  const r = await getVault(userId, connectorId);
  if (r && "off" in r) return syncOff();
  if (!r) return notFound("This connector");
  return ok({ connectorId, version: r.version, data: r.data });
}

export async function vaultPut(req: Request, userId: string, connectorId: string): Promise<NextResponse> {
  if (!isId(connectorId)) return fail(400, "bad_request", "Invalid connector id.");
  const b = await body(req, MAX_VAULT_TEXT);
  if (b === "too_big") return fail(413, "too_big", "This connector's settings are too big to sync.", { bytes: 0, limit: MAX_VAULT_TEXT });
  if (b === "bad") return fail(400, "bad_request", "Invalid request.");
  const v = checkVaultPut(b);
  if (typeof v === "string") return fail(400, "bad_request", v);
  const r = await putVault(userId, connectorId, v.baseVersion, v.data);
  if ("off" in r) return syncOff();
  if ("full" in r) return fail(413, "over_limit", `At most ${MAX_VAULT_ITEMS} connectors are kept in the cloud.`, { bytes: 0, limit: MAX_VAULT_ITEMS });
  if ("conflict" in r) return fail(409, "conflict", "This connector changed on another device. Merge and send it again.", { version: r.version, data: r.data });
  return ok({ version: r.version });
}

/** Heartbeat for a job the caller holds; userId null = the runner (any account, checked by claimed_by). */
export async function jobHeartbeat(req: Request, jobId: string, kind: "desktop" | "runner", userId: string | null): Promise<NextResponse> {
  const b = await body(req, 4096);
  const field = kind === "desktop" ? "deviceId" : "runnerId";
  if (b === "too_big" || b === "bad" || !isId(b[field])) return fail(400, "bad_request", `${field} is missing or invalid.`);
  const lease = await heartbeat(jobId, `${kind}:${b[field] as string}`, userId);
  if (!lease) return fail(409, "conflict", "This job's lease was lost: another device took it, or it ended.");
  return ok({ leaseUntil: lease });
}

export async function jobDone(req: Request, jobId: string, kind: "desktop" | "runner", userId: string | null): Promise<NextResponse> {
  const b = await body(req, 8192);
  if (b === "too_big" || b === "bad") return fail(400, "bad_request", "Invalid request.");
  const v = checkDone(b, kind === "desktop" ? "deviceId" : "runnerId");
  if (typeof v === "string") return fail(400, "bad_request", v);
  // A routine the runner ran: when, how it went, and when it runs next (lib/cloud.ts routineRan), recorded while
  // the claim is still its own.
  const ran = kind === "runner" ? routineOf(b.routine) : null;
  if (ran) await routineRan(jobId, `${kind}:${v.by}`, ran);
  const done = await finishJob(jobId, `${kind}:${v.by}`, userId, v.status, v.error);
  if (!done) return fail(409, "conflict", "This job's lease was lost: another device took it, or it ended.");
  return ok({ ok: true });
}

const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The routine part of a runner's "done" ({routineId, ranAt, status, next}), checked. */
function routineOf(v: unknown): { routineId: string; ranAt: string; status: string; next: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ranAt = isoOrNull(o.ranAt);
  if (typeof o.routineId !== "string" || !/^[\w-]{1,64}$/.test(o.routineId) || !ranAt) return null;
  const status = typeof o.status === "string" && /^[a-z_]{1,20}$/.test(o.status) ? o.status : "ok";
  return { routineId: o.routineId, ranAt, status, next: isoOrNull(o.next) };
}
