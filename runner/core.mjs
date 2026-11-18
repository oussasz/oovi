// The cloud runner's pure parts (no I/O): settings from the environment, which requests a job's server may make,
// merging a chat after a conflict, retries, fairness and what may appear in the logs.
// Tested in tests/unit/runner-core.test.mts.

const ID_RE = /^[\w-]{1,80}$/;
export const isId = (v) => typeof v === "string" && ID_RE.test(v);

/** Settings from the environment. A string is what is wrong (the runner refuses to start). */
export function readConfig(env) {
  const web = String(env.OOVI_WEB_URL || "").trim().replace(/\/+$/, "");
  let u;
  try {
    u = new URL(web);
  } catch {
    return "OOVI_WEB_URL is missing or not a web address (example: https://oovi.conuron.com).";
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "OOVI_WEB_URL must start with https://";
  const secret = String(env.RUNNER_SECRET || "");
  if (secret.length < 32) return "RUNNER_SECRET is missing or shorter than 32 characters.";
  const int = (v, def, min, max) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    web,
    secret,
    runnerId: isId(env.RUNNER_ID) ? env.RUNNER_ID : `runner-${Math.random().toString(36).slice(2, 10)}`,
    concurrency: int(env.RUNNER_CONCURRENCY, 2, 1, 16),
    perAccount: int(env.RUNNER_PER_ACCOUNT, 1, 1, 4),
    jobTimeoutMs: int(env.RUNNER_JOB_TIMEOUT_MS, 15 * 60_000, 30_000, 2 * 3600_000),
    drainMs: int(env.RUNNER_DRAIN_MS, 20_000, 0, 120_000),
    heartbeatMs: int(env.RUNNER_HEARTBEAT_MS, 30_000, 1000, 60_000),
    pushEveryMs: int(env.RUNNER_PUSH_MS, 2000, 200, 30_000),
    memoryMb: int(env.RUNNER_JOB_MEMORY_MB, 768, 256, 8192),
    maxConcurrentAi: int(env.RUNNER_AI_CONCURRENT, 3, 1, 10),
    tmp: String(env.RUNNER_TMP || ""),
    stateDir: String(env.RUNNER_STATE_DIR || ""),
  };
}

/**
 * What a job's server may ask the website for, through the runner's local proxy (it never sees RUNNER_SECRET):
 * theOovi calls billed to the job's account, that account's setup, and the public catalog. Nothing else.
 */
export function proxyRoute(method, pathname) {
  const p = pathname.replace(/\/+$/, "");
  if (method === "POST" && p === "/api/v1/ai/messages") return "ai";
  if (method === "GET" && p === "/api/v1/ai/status") return "status";
  if (method === "GET" && p === "/api/v1/setup") return "setup-get";
  if (method === "PUT" && p === "/api/v1/setup") return "setup-put";
  if (method === "GET" && p === "/api/v1/catalog") return "catalog";
  return null;
}

/** theOovi's status as the job's server sees it: the website checks credits on every call and refuses there. */
export function runnerStatus(maxConcurrent) {
  return {
    state: "ok",
    message: null,
    displayName: "theOovi",
    balance: 1,
    dailyLimit: 0,
    dailyUsed: 0,
    resetsAt: new Date(Date.now() + 864e5).toISOString(),
    plan: { id: "cloud", name: "Cloud" },
    planUntil: null,
    maxInputTokens: 100000,
    maxConcurrent,
    links: { subscribe: "", pricing: "", pilot: "", feedback: "" },
    pilot: { open: false, eligible: false, status: null, credits: 0 },
    // No desktop control in the cloud: the computer toolset is never offered.
    desktop: false,
  };
}

/** The id the job's user message gets: the phone's own, else one made from the job (the same on a retry). */
export const entryIdFor = (job) => (isId(job?.payload?.entryId) && job.payload.entryId.length <= 40 ? job.payload.entryId : `j${String(job.id).replace(/[^\w]/g, "").slice(0, 24)}`);

/**
 * A job tried again (its runner stopped, or the lease ran out): the message and what was done for it are taken
 * out, so the run starts the same message over instead of adding it twice. Other entries are kept.
 */
export function resetForRetry(chat, entryId) {
  if (!chat || !Array.isArray(chat.entries)) return chat;
  const at = chat.entries.findIndex((e) => e && e.id === entryId);
  if (at < 0) return chat;
  // Only that message and the bots' answers after it (until the user's next message).
  let end = at + 1;
  while (end < chat.entries.length && chat.entries[end]?.kind !== "user") end++;
  return { ...chat, entries: [...chat.entries.slice(0, at), ...chat.entries.slice(end)], pending: undefined };
}

/**
 * A 409 when pushing the chat: another device saved it meanwhile. Entries are merged by id; for an entry both
 * have, this runner's copy wins (the job's lease makes it the only one working on this chat), others are added
 * in time order.
 */
export function mergeChat(mine, theirs) {
  if (!theirs || !Array.isArray(theirs.entries)) return mine;
  if (!mine || !Array.isArray(mine.entries)) return theirs;
  const ids = new Set(mine.entries.map((e) => e.id));
  const extra = theirs.entries.filter((e) => e && !ids.has(e.id));
  if (!extra.length) return mine;
  const entries = [...mine.entries];
  for (const e of extra) {
    const at = entries.findIndex((x) => Number(x.at) > Number(e.at));
    if (at < 0) entries.push(e);
    else entries.splice(at, 0, e);
  }
  return { ...mine, entries };
}

/** How long to wait before claiming again: quick while there is work, slower when idle or failing (2 s to 30 s). */
export function nextDelay(misses, failed) {
  const base = failed ? 5000 : 2000;
  return Math.min(30_000, Math.round(base * 1.6 ** Math.min(Math.max(0, misses), 10)));
}

/** Accounts that already have as many jobs running here as one account may: the website skips them. */
export function busyAccounts(active, perAccount) {
  const n = new Map();
  for (const j of active) n.set(j.userId, (n.get(j.userId) ?? 0) + 1);
  return [...n].filter(([, k]) => k >= perAccount).map(([u]) => u);
}

/** Can this claimed job start here now? (The website may not know `exclude`; one chat runs once at a time.) */
export function canStart(job, active, perAccount) {
  if (active.some((j) => j.chatId === job.chatId && j.userId === job.userId)) return "chat busy";
  if (active.filter((j) => j.userId === job.userId).length >= perAccount) return "account busy";
  return null;
}

/** The job's end status for the website. */
export function outcomeOf(r) {
  if (r.needsComputer) return { status: "needs_computer" };
  if (r.error) return { status: "failed", error: r.error };
  return { status: "done" };
}

/** A time zone the job's server can use (IANA name), else UTC. */
export function timeZoneOf(tz) {
  if (typeof tz !== "string" || !/^[A-Za-z_+\-/0-9]{1,64}$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

// Only these fields ever reach the logs: no chat text, no names, no tokens.
const LOG_KEYS = new Set(["ev", "job", "acct", "kind", "status", "ms", "code", "tool", "active", "n", "runner", "connectors", "attempt", "http"]);

/** One log line (JSON). Unknown fields are dropped; strings are cut short and stripped of line breaks. */
export function logLine(fields) {
  const out = { t: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!LOG_KEYS.has(k) || v === undefined) continue;
    out[k] = typeof v === "string" ? v.replace(/[\r\n]+/g, " ").slice(0, 80) : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 80);
  }
  return JSON.stringify(out);
}

/** Short error codes for the website and the logs (never the error text, which can quote the chat). */
export function errorCode(e) {
  const m = String(e?.code || e?.message || e || "");
  if (/timeout|timed out/i.test(m)) return "timeout";
  if (/lease/i.test(m)) return "lease_lost";
  if (/start|spawn|ready/i.test(m)) return "server_start";
  if (/chat not found/i.test(m)) return "chat_not_found";
  if (/setup/i.test(m)) return "setup";
  if (/crash|exit/i.test(m)) return "server_crash";
  return "error";
}
