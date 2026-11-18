// The website's runner-only API (docs/CLOUD-BUILD.md): every call carries x-oovi-runner: RUNNER_SECRET.
// Errors carry the HTTP status only (never a response body, which could quote a chat).

export class WebError extends Error {
  constructor(status, code) {
    super(`website answered ${status}${code ? ` (${code})` : ""}`);
    this.status = status;
    this.code = code;
  }
}

export function webClient(cfg) {
  const base = `${cfg.web}/api/v1/cloud/runner`;
  const enc = encodeURIComponent;

  async function call(method, route, body, { timeoutMs = 30_000, ok = [] } = {}) {
    let res;
    try {
      res = await fetch(`${base}${route}`, {
        method,
        headers: { "x-oovi-runner": cfg.secret, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new WebError(0, e?.name === "TimeoutError" ? "timeout" : "offline");
    }
    const text = await res.text();
    let j = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      j = null;
    }
    if (!res.ok && !ok.includes(res.status)) throw new WebError(res.status, typeof j?.code === "string" ? j.code.slice(0, 40) : undefined);
    return { status: res.status, body: j };
  }

  return {
    /** {job | null}. exclude: accounts already busy on this runner (fairness). */
    claim: async (exclude) => (await call("POST", "/claim", { runnerId: cfg.runnerId, exclude })).body?.job ?? null,
    /** false: the lease is gone (another runner or the desktop has the job now). */
    heartbeat: async (jobId) => (await call("POST", `/jobs/${enc(jobId)}/heartbeat`, {}, { ok: [404, 409, 410] })).status < 300,
    done: (jobId, outcome) => call("POST", `/jobs/${enc(jobId)}/done`, outcome),
    /** Back to the queue (this runner is stopping). */
    release: (jobId) => call("POST", `/jobs/${enc(jobId)}/release`, {}, { ok: [404, 409, 410] }),
    getChat: async (userId, chatId) => {
      const r = await call("GET", `/chats/${enc(userId)}/${enc(chatId)}`, undefined, { ok: [404] });
      return r.status === 404 ? { version: 0, chat: null } : { version: Number(r.body?.version) || 0, chat: r.body?.chat ?? null };
    },
    /** {version} or {conflict: {version, chat}}. */
    putChat: async (userId, chatId, baseVersion, chat) => {
      const r = await call("PUT", `/chats/${enc(userId)}/${enc(chatId)}`, { baseVersion, chat }, { ok: [409], timeoutMs: 60_000 });
      return r.status === 409 ? { conflict: { version: Number(r.body?.version) || 0, chat: r.body?.chat ?? null } } : { version: Number(r.body?.version) || baseVersion + 1 };
    },
    getVault: async (userId, connectorId) => {
      const r = await call("GET", `/vault/${enc(userId)}/${enc(connectorId)}`, undefined, { ok: [404] });
      return r.status === 404 ? null : { version: Number(r.body?.version) || 0, data: r.body?.data ?? null };
    },
    putVault: async (userId, connectorId, baseVersion, data) => (await call("PUT", `/vault/${enc(userId)}/${enc(connectorId)}`, { baseVersion, data }, { ok: [409] })).status < 300,
    /** Raw pass-through for the proxy: {status, headers, body (Buffer)}. */
    raw: async (method, route, body, timeoutMs) => {
      const res = await fetch(`${base}${route}`, {
        method,
        headers: { "x-oovi-runner": cfg.secret, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: res.status, retryAfter: res.headers.get("retry-after"), body: Buffer.from(await res.arrayBuffer()) };
    },
    /** The public catalog (no secret needed, none sent). */
    catalog: async () => {
      const res = await fetch(`${cfg.web}/api/v1/catalog`, { signal: AbortSignal.timeout(20_000) });
      return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
    },
  };
}
