// oovi's cloud runner: runs phone tasks while the user's computer is off (docs/CLOUD-BUILD.md, "Who runs a job").
// It only calls out (no public port): claims a job from the website, runs it with the app's own engine in a server
// of its own (runner/job-server.cjs, fresh data folder, theOovi only), pushes the chat after each step, ends the
// job, wipes the folder. Stateless: everything lives in the website's database.
//
//   OOVI_WEB_URL=https://oovi.conuron.com RUNNER_SECRET=… node runner/index.mjs
//
// Settings (environment): RUNNER_CONCURRENCY (2), RUNNER_PER_ACCOUNT (1), RUNNER_JOB_TIMEOUT_MS (15 min),
// RUNNER_DRAIN_MS (20 s on SIGTERM before the leases are released), RUNNER_JOB_MEMORY_MB (768), RUNNER_ID,
// RUNNER_TMP, RUNNER_STATE_DIR (health file), OOVI_STANDALONE (the built server).
// Logs: one JSON line per event, never chat content (runner/core.mjs logLine).
import { fork } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { busyAccounts, canStart, entryIdFor, errorCode, failRunning, isId, logLine, loopStuck, mergeChat, nextDelay, outcomeOf, readConfig, resetForRetry, routineReport, timeZoneOf } from "./core.mjs";
import { startProxy } from "./proxy.mjs";
import { webClient } from "./web.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The container's memory limit in bytes (cgroup v2, then v1), or null when there is none to read. */
function memoryLimit() {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const n = Number(fs.readFileSync(f, "utf8").trim());
      // No limit shows as "max" (v2) or a huge number (v1).
      if (Number.isFinite(n) && n > 0 && n < 2 ** 50) return n;
    } catch {
      /* not this kind of machine */
    }
  }
  return null;
}
const cfg = readConfig(process.env, memoryLimit());
if (typeof cfg === "string") {
  console.error(logLine({ ev: "config_error", code: cfg }));
  console.error(cfg);
  process.exit(1);
}
const STANDALONE = process.env.OOVI_STANDALONE || path.resolve(here, "../.next/standalone");
if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error(`No built server at ${STANDALONE} (run npm run build, or set OOVI_STANDALONE).`);
  process.exit(1);
}
const TMP = cfg.tmp || path.join(os.tmpdir(), "oovi-runner");
const STATE = cfg.stateDir || TMP;
fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
fs.mkdirSync(STATE, { recursive: true });

const log = (f) => console.log(logLine({ runner: cfg.runnerId, ...f }));
const acct = (userId) => crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 10);
const short = (id) => String(id).slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const web = webClient(cfg);
const proxy = startProxy(cfg, web);
const proxyPort = await proxy.listen();

/** Jobs running here: {id, userId, chatId, stop(reason), done: Promise}. */
const active = new Map();
let stopping = false;
let lastClaimOk = Date.now();

function writeHealth() {
  try {
    fs.writeFileSync(path.join(STATE, "health.json"), JSON.stringify({ at: Date.now(), active: active.size, lastClaimOk, stopping }));
  } catch {
    /* the health check will say so */
  }
}

async function freePort() {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

/** The job's own server, and request/answer over its IPC channel. */
async function startJobServer(job, dir, token) {
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    LANG: "C.UTF-8",
    NODE_ENV: "production",
    // The user's time zone: the phone sends it with each job (web/app/m/_ui/MobileApp.tsx).
    TZ: timeZoneOf(job.timezone ?? job.payload?.timeZone),
    PORT: String(await freePort()),
    OOVI_DATA: dir,
    OOVI_STANDALONE: STANDALONE,
    OOVI_CLOUD_RUNNER: "1",
    OOVI_CLOUD_URL: `http://127.0.0.1:${proxyPort}`,
    OOVI_VERSION: process.env.OOVI_VERSION || "cloud",
    OOVI_JOB_TOKEN: token,
    OOVI_JOB_USER: job.userId,
    ...(typeof job.userName === "string" ? { OOVI_JOB_USER_NAME: job.userName.slice(0, 80) } : {}),
    NEXT_TELEMETRY_DISABLED: "1",
    // Tests only: a stand-in connector on this machine (never set on a server).
    ...(process.env.RUNNER_TEST_HOSTS ? { OOVI_CLOUD_TEST_HOSTS: process.env.RUNNER_TEST_HOSTS } : {}),
  };
  const child = fork(path.join(here, "job-server.cjs"), [], { env, execArgv: [`--max-old-space-size=${cfg.memoryMb}`], stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced" });
  // Its error output can quote a chat: only its size is kept, never shown.
  child.stderr?.on("data", () => {});
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();
  let exited = null;
  const exitedP = new Promise((resolve) => child.on("exit", (code, sig) => resolve((exited = { code, sig }))));
  child.on("message", (m) => {
    if (m?.type === "reply" && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      w.resolve(m);
    } else for (const l of listeners) l(m);
  });
  child.on("exit", () => {
    for (const w of waiting.values()) w.reject(new Error("server exit"));
    waiting.clear();
  });
  const ask = (msg, ms = 120_000) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error("server exit"));
      const id = ++seq;
      const t = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${msg.type} timed out`));
      }, ms);
      waiting.set(id, { resolve: (m) => (clearTimeout(t), resolve(m)), reject: (e) => (clearTimeout(t), reject(e)) });
      try {
        child.send({ ...msg, id });
      } catch (e) {
        clearTimeout(t);
        waiting.delete(id);
        reject(e);
      }
    });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server start timed out")), 90_000);
    const l = (m) => {
      if (m?.type === "ready") {
        clearTimeout(t);
        listeners.delete(l);
        resolve();
      }
    };
    listeners.add(l);
    exitedP.then(() => (clearTimeout(t), reject(new Error("server exit before ready"))));
  });
  return {
    ask,
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    exited: exitedP,
    kill: async () => {
      if (exited) return;
      child.kill("SIGTERM");
      const t = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exitedP;
      clearTimeout(t);
    },
  };
}

/** Runs one claimed job to its end. Never throws. */
async function runJob(job, ctl) {
  const t0 = Date.now();
  const base = { job: short(job.id), acct: acct(job.userId), kind: job.kind };
  log({ ev: "job_start", ...base });
  let dir = null;
  let token = null;
  let srv = null;
  let hb = null;
  let leaseLost = false;
  let result = { error: null, needsComputer: null };
  let version = 0;
  let pushing = Promise.resolve();
  let pushedAt = 0;
  let pushTimer = null;
  /** The chat was deleted on another device while the job ran. */
  let chatGone = false;
  /** Whether the last save of the chat reached the account (the final one decides how the job ends). */
  let pushOk = true;
  let routineNext; // a routine's next time, read before its run starts (undefined: not known)
  let routineIdOf = null;

  const push = () => {
    pushing = pushing.then(async () => {
      if (!srv || leaseLost || chatGone) return;
      const r = await srv.ask({ type: "chat", chatId: job.chatId }, 30_000);
      if (!r.ok || !r.chat) return;
      pushOk = false;
      let chat = r.work ? { ...r.chat, work: r.work } : r.chat;
      for (let i = 0; i < 3; i++) {
        const out = await web.putChat(job.userId, job.chatId, version, chat);
        if (!out.conflict) {
          version = out.version;
          pushedAt = Date.now();
          pushOk = true;
          return;
        }
        // Deleted on the phone or the computer while this job ran: the run stops and nothing is saved back
        // (saving on top of the tombstone brought the deleted chat back).
        if (out.conflict.deleted) {
          chatGone = true;
          pushOk = true;
          ctl.stop("deleted");
          return;
        }
        version = out.conflict.version;
        chat = mergeChat(chat, out.conflict.chat);
      }
      log({ ev: "push_conflict", ...base });
    }).catch((e) => log({ ev: "push_failed", ...base, code: errorCode(e), http: e?.status }));
    return pushing;
  };
  /** The last save, tried again a few times: a reply that never reaches the account must not end as "done". */
  const pushLast = async () => {
    for (let i = 0; i < 4; i++) {
      await push();
      if (pushOk || leaseLost) return;
      await sleep(1500 * (i + 1));
    }
  };
  const pushSoon = () => {
    if (pushTimer) return;
    const wait = Math.max(0, cfg.pushEveryMs - (Date.now() - pushedAt));
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void push();
    }, wait);
  };

  try {
    if (job.kind === "stop") {
      // Stop: the chat's run here (if any) stops; the stop job itself is done at once.
      for (const other of active.values()) if (other !== ctl && other.chatId === job.chatId && other.userId === job.userId) other.stop("user");
      result = { error: null, needsComputer: null };
      return;
    }
    hb = setInterval(async () => {
      try {
        const beat = await web.heartbeat(job.id);
        if (!beat.held) {
          leaseLost = true;
          ctl.stop("lease");
        } else if (beat.stop) {
          log({ ev: "job_stop_asked", ...base });
          ctl.stop("user");
        }
      } catch (e) {
        log({ ev: "heartbeat_failed", ...base, http: e?.status });
      }
    }, cfg.heartbeatMs);

    // The chat as the account has it; a retried job starts its message over.
    const got = await web.getChat(job.userId, job.chatId);
    // Deleted on another device after the message was sent: nothing to answer in.
    if (got.deleted) throw new Error("chat not found");
    version = got.version;
    let chat = got.chat;
    let work = null;
    if (chat && chat.work && typeof chat.work === "object") {
      work = chat.work;
      const { work: _w, ...rest } = chat;
      chat = rest;
    }
    const payload = job.kind === "message" ? { ...(job.payload || {}), entryId: entryIdFor(job) } : job.payload || {};
    if (job.kind === "message" && chat) chat = resetForRetry(chat, payload.entryId);
    if (chat && chat.id !== job.chatId) chat = null;

    dir = fs.mkdtempSync(path.join(TMP, "job-"));
    token = proxy.issue(job.userId);
    srv = await startJobServer(job, dir, token);
    if (ctl.stopped) throw new Error(ctl.stopped);
    // A routine due while the computer is off: its chat is made if the account doesn't have it yet.
    const routineId = job.kind === "routine" && typeof payload.routineId === "string" ? payload.routineId : null;
    const prep = await srv.ask({ type: "prepare", chatId: job.chatId, chat, work, ...(routineId ? { routineId } : {}) }, 120_000);
    if (!prep.ok) throw new Error(prep.error === "chat not found" ? "chat not found" : "setup failed");
    routineIdOf = routineId;
    if (routineId && (prep.routineNext === null || typeof prep.routineNext === "string")) routineNext = prep.routineNext;
    // The connectors this chat's bots use, with their sign-in, from the account's vault.
    const vault = [];
    const versions = new Map();
    for (const id of Array.isArray(prep.mcpIds) ? prep.mcpIds.filter(isId).slice(0, 20) : []) {
      const v = await web.getVault(job.userId, id).catch(() => null);
      if (v?.data && typeof v.data === "object") {
        vault.push({ ...v.data, id });
        versions.set(id, { version: v.version, data: v.data });
      }
    }
    const conn = vault.length ? await srv.ask({ type: "connectors", vault }, 30_000) : { connectors: 0 };

    // Run, pushing the chat as it changes.
    const ended = new Promise((resolve) => {
      const off = srv.on((m) => {
        if (m?.type === "step" && m.chatId === job.chatId) pushSoon();
        else if (m?.type === "ended" && m.chatId === job.chatId) {
          off();
          resolve({ needsComputer: typeof m.needsComputer === "string" ? m.needsComputer : null, routine: m.routine && typeof m.routine === "object" ? m.routine : null });
        }
      });
      srv.exited.then(() => resolve({ crashed: true }));
    });
    const started = await srv.ask({ type: "run", chatId: job.chatId, kind: job.kind, payload }, 30_000);
    if (!started.ok) throw new Error(String(started.error || "run refused"));
    log({ ev: "job_running", ...base, connectors: conn.connectors ?? 0 });
    ctl.onStop = (why) => {
      ctl.stopped = why;
      void srv.ask({ type: "stop", chatId: job.chatId }, 10_000).catch(() => {});
      // A run that doesn't stop within 30 s: its server is ended (the job then ends as failed, or is released).
      setTimeout(() => void srv.kill().catch(() => {}), 30_000).unref();
    };
    if (ctl.stopped) ctl.onStop(ctl.stopped);
    const timeout = setTimeout(() => ctl.stop("timeout"), cfg.jobTimeoutMs);
    const end = await ended;
    clearTimeout(timeout);
    if (end.crashed) throw new Error("server crash");
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    await pushLast();
    if (chatGone) throw new Error("chat not found");
    if (!pushOk && !leaseLost) throw new Error("save refused");
    // What the job changed in the setup goes back to the account; refreshed sign-ins go back to the vault.
    const fin = await srv.ask({ type: "finish" }, 60_000).catch(() => null);
    for (const s of Array.isArray(fin?.signIns) ? fin.signIns : []) {
      const was = versions.get(s.id);
      if (was) await web.putVault(job.userId, s.id, was.version, { ...was.data, oauth: s.oauth }).catch(() => false);
    }
    if (end.needsComputer) log({ ev: "needs_computer", ...base, tool: end.needsComputer });
    result = { error: ctl.stopped === "timeout" ? "timeout" : null, needsComputer: end.needsComputer, routine: end.routine };
  } catch (e) {
    result = { error: errorCode(e), needsComputer: null };
  } finally {
    clearInterval(hb);
    if (pushTimer) clearTimeout(pushTimer);
    await pushing;
    // A job that failed: what the account's copy still shows as "working" for this message is closed as an error.
    if (result.error && !leaseLost && !chatGone && ctl.stopped !== "shutdown" && job.kind === "message") {
      try {
        const cur = await web.getChat(job.userId, job.chatId);
        const fixed = cur.chat ? failRunning(cur.chat, entryIdFor(job)) : null;
        if (fixed) await web.putChat(job.userId, job.chatId, cur.version, fixed);
      } catch {
        /* the job still ends as failed: the phone marks the message for sending again */
      }
    }
    if (srv) await srv.kill().catch(() => {});
    if (token) proxy.forget(token);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    const ms = Date.now() - t0;
    try {
      if (leaseLost) log({ ev: "job_lease_lost", ...base, ms });
      else if (ctl.stopped === "shutdown") {
        await web.release(job.id);
        log({ ev: "job_released", ...base, ms });
      } else {
        let out = outcomeOf(result);
        let routine = routineReport(job, result?.routine ?? null, routineIdOf, routineNext, new Date().toISOString());
        // A routine that needs the computer isn't kept for it (the desktop runs its own routines and catches up):
        // the job ends here, and the cloud stops running it until the computer says when it runs next.
        if (job.kind === "routine" && out.status === "needs_computer") {
          out = { status: "done" };
          routine = routine ? { ...routine, status: "needs_computer", next: null } : null;
        }
        // A routine: when it ran, how, and its next time (the website keeps it going while the computer is off).
        await web.done(job.id, routine ? { ...out, routine } : out);
        log({ ev: "job_end", ...base, status: out.status, code: out.error, ms });
      }
    } catch (e) {
      log({ ev: "job_report_failed", ...base, http: e?.status, ms });
    }
  }
}

function launch(job) {
  const ctl = {
    id: job.id,
    userId: job.userId,
    chatId: job.chatId,
    stopped: null,
    onStop: null,
    stop(why) {
      if (this.stopped && why !== "shutdown") return;
      this.stopped = why;
      this.onStop?.(why);
    },
  };
  active.set(job.id, ctl);
  ctl.done = runJob(job, ctl).finally(() => {
    active.delete(job.id);
    writeHealth();
  });
}

/** When the claim loop last turned (it turns at least every 30 s). */
let lastTurn = Date.now();

async function loop() {
  let misses = 0;
  while (!stopping) {
    lastTurn = Date.now();
    writeHealth();
    if (active.size >= cfg.concurrency) {
      await Promise.race([...active.values()].map((j) => j.done).concat(sleep(1000)));
      continue;
    }
    let job = null;
    let failed = false;
    try {
      job = await web.claim(busyAccounts([...active.values()], cfg.perAccount));
      lastClaimOk = Date.now();
    } catch (e) {
      failed = true;
      log({ ev: "claim_failed", http: e?.status, code: e?.code });
    }
    if (stopping && job) {
      await web.release(job.id).catch(() => {});
      break;
    }
    if (!job) {
      await sleep(nextDelay(misses++, failed, cfg.idleMs));
      continue;
    }
    misses = 0;
    if (!isId(job.id) || !isId(job.userId) || !isId(job.chatId) || !["message", "decision", "stop", "routine"].includes(job.kind)) {
      log({ ev: "job_invalid", job: short(job.id) });
      if (isId(job.id)) await web.done(job.id, { status: "failed", error: "invalid" }).catch(() => {});
      continue;
    }
    const busy = job.kind === "stop" ? null : canStart(job, [...active.values()], cfg.perAccount);
    if (busy) {
      // The website didn't skip it: back to the queue, and a short pause so it goes elsewhere.
      await web.release(job.id).catch(() => {});
      log({ ev: "job_deferred", job: short(job.id), code: busy });
      await sleep(1000);
      continue;
    }
    launch(job);
  }
}

async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log({ ev: "shutdown", code: sig, active: active.size });
  writeHealth();
  // Jobs get a moment to finish; then they stop, their chat is pushed, and their lease goes back to the queue.
  const all = Promise.all([...active.values()].map((j) => j.done));
  const finished = await Promise.race([all.then(() => true), sleep(cfg.drainMs).then(() => false)]);
  if (!finished) {
    for (const j of active.values()) j.stop("shutdown");
    await Promise.race([all, sleep(20_000)]);
  }
  await proxy.close().catch(() => {});
  log({ ev: "stopped", active: active.size });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (e) => log({ ev: "unhandled", code: errorCode(e) }));

log({ ev: "start", n: cfg.concurrency });
setInterval(writeHealth, 15_000).unref();
// The health file above is written by a timer, so it stays fresh even if the claim loop is stuck. This is the
// check on the loop itself: silent for 5 minutes, the runner ends and Docker starts a fresh one (its jobs'
// leases run out and they are taken again).
setInterval(() => {
  if (stopping || !loopStuck(lastTurn, Date.now())) return;
  log({ ev: "loop_stuck" });
  process.exit(1);
}, 60_000).unref();
await loop();
