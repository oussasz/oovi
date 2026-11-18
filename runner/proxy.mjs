// The local door between a job's server and the website. The job's server gets OOVI_CLOUD_URL pointing here and a
// token for its job only (as its "session"); this proxy adds RUNNER_SECRET and the job's account. A job's server can
// therefore reach theOovi for its own account, its account's setup and the public catalog, and nothing else.
// Listens on 127.0.0.1 only.
import http from "node:http";
import crypto from "node:crypto";
import { proxyRoute, runnerStatus } from "./core.mjs";

const MAX_BODY = 24 * 1024 * 1024;

export function startProxy(cfg, web) {
  const tokens = new Map(); // token -> {userId}

  const send = (res, status, body, extra = {}) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
    res.end(buf);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const parts = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > MAX_BODY) {
          reject(new Error("too large"));
          req.destroy();
        } else parts.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(parts)));
      req.on("error", reject);
    });

  const who = (req) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
    if (!m) return null;
    for (const [t, v] of tokens) {
      const a = Buffer.from(t);
      const b = Buffer.from(m[1]);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return v;
    }
    return null;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const route = proxyRoute(req.method || "GET", url.pathname);
      if (!route) return send(res, 404, { error: "Not available in the cloud." });
      if (route === "catalog") {
        const r = await web.catalog();
        return send(res, r.status, r.body);
      }
      const job = who(req);
      if (!job) return send(res, 401, { error: "You're signed out." });
      if (route === "status") return send(res, 200, runnerStatus(cfg.maxConcurrentAi));
      const uid = encodeURIComponent(job.userId);
      if (route === "setup-get") {
        const r = await web.raw("GET", `/setup/${uid}`, undefined, 30_000);
        return send(res, r.status, r.body);
      }
      const body = await readBody(req);
      if (route === "setup-put") {
        const r = await web.raw("PUT", `/setup/${uid}`, body, 30_000);
        return send(res, r.status, r.body);
      }
      // theOovi, billed to the job's account by the website.
      const r = await web.raw("POST", `/ai/${uid}`, body, 10 * 60_000);
      return send(res, r.status, r.body, r.retryAfter ? { "retry-after": r.retryAfter } : {});
    } catch (e) {
      if (!res.headersSent) send(res, e?.message === "too large" ? 413 : 502, { error: "Can't reach the oovi service." });
    }
  });
  server.requestTimeout = 11 * 60_000;

  return {
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    /** A token for one job: its server can act for that account only, until forget(). */
    issue: (userId) => {
      const token = crypto.randomBytes(32).toString("base64url");
      tokens.set(token, { userId });
      return token;
    },
    forget: (token) => tokens.delete(token),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
