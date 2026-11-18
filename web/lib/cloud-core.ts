// oovi cloud, the pure parts (no database, no local imports): limits, checks of what clients send, the
// runner's secret check. Tested in tests/unit/cloud.test.mts. The database side is web/lib/cloud.ts.
import crypto from "node:crypto";

/** 100 MB of chats per account, compressed (docs/CLOUD-BUILD.md, owner may change it). */
export const ACCOUNT_LIMIT_BYTES = 100 * 1024 * 1024;
/** One chat as sent (JSON text). Vercel refuses request bodies over 4.5 MB, so the limit stays under it. */
export const MAX_CHAT_TEXT = 4 * 1024 * 1024;
/** One connector's settings and sign-in. */
export const MAX_VAULT_TEXT = 256 * 1024;
export const MAX_VAULT_ITEMS = 200;
export const MAX_CHATS = 20_000;
/** A job's payload (a message, an approval answer, Stop). */
export const MAX_JOB_TEXT = 256 * 1024;
/** Jobs waiting (queued or needs_computer) per account. */
export const MAX_OPEN_JOBS = 100;
export const MAX_DEVICES = 50;
export const LEASE_SECONDS = 120;
export const ONLINE_SECONDS = 60;
/** The runner takes a job only when it waited this long and no desktop of the account is online. */
export const RUNNER_DELAY_SECONDS = 5;
export const TOMBSTONE_DAYS = 30;
export const LONG_POLL_MS = 25_000;
export const MAX_ERROR_TEXT = 500;

export const JOB_KINDS = ["message", "decision", "stop"] as const;
export const DONE_STATUSES = ["done", "failed", "needs_computer"] as const;
export type JobKindCore = (typeof JOB_KINDS)[number];
export type DoneStatusCore = (typeof DONE_STATUSES)[number];

/** Chat, connector, device and runner ids: letters, digits, _ . - : (what the app uses), 1-100 characters. */
export const ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
/** Account ids (Better Auth): letters, digits, _ and -. */
export const USER_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v) && v !== "." && v !== "..";
export const isUserId = (v: unknown): v is string => typeof v === "string" && USER_ID_RE.test(v);
export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 2_000_000_000;

/** PUT /chats/<chatId> body. The chat's own id, when it has one, must be the one in the address. */
export function checkChatPut(chatId: string, body: unknown): { baseVersion: number; chat: Record<string, unknown> } | string {
  if (!isObject(body)) return "Invalid request.";
  if (!isVersion(body.baseVersion)) return "baseVersion must be a whole number.";
  if (!isObject(body.chat)) return "chat must be an object.";
  if ("id" in body.chat && body.chat.id !== chatId) return "The chat's id doesn't match the address.";
  return { baseVersion: body.baseVersion, chat: body.chat };
}

/** PUT /vault/<connectorId> body: a connector's settings, sign-in or own key. Never an AI model key (refused). */
export function checkVaultPut(body: unknown): { baseVersion: number; data: Record<string, unknown> } | string {
  if (!isObject(body)) return "Invalid request.";
  if (!isVersion(body.baseVersion)) return "baseVersion must be a whole number.";
  if (!isObject(body.data)) return "data must be an object.";
  if (looksLikeAiKey(body.data)) return "AI model keys stay on your computer: they can't be synced. A connector's own key is fine.";
  return { baseVersion: body.baseVersion, data: body.data };
}

/** POST /jobs body. */
export function checkJobCreate(body: unknown): { chatId: string; kind: JobKindCore; payload: Record<string, unknown> } | string {
  if (!isObject(body)) return "Invalid request.";
  if (!isId(body.chatId)) return "chatId is missing or invalid.";
  if (typeof body.kind !== "string" || !(JOB_KINDS as readonly string[]).includes(body.kind)) return "kind must be message, decision or stop.";
  const payload = body.payload === undefined ? {} : body.payload;
  if (!isObject(payload)) return "payload must be an object.";
  return { chatId: body.chatId, kind: body.kind as JobKindCore, payload };
}

/** POST /jobs/claim body (desktop). */
export function checkClaim(body: unknown): { deviceId: string; chatIds: string[] | null } | string {
  if (!isObject(body)) return "Invalid request.";
  if (!isId(body.deviceId)) return "deviceId is missing or invalid.";
  if (body.kind !== undefined && body.kind !== "desktop") return "Only the desktop app claims jobs here.";
  if (body.chatIds === undefined || body.chatIds === null) return { deviceId: body.deviceId, chatIds: null };
  if (!Array.isArray(body.chatIds) || body.chatIds.length > 5000 || !body.chatIds.every(isId)) return "chatIds must be a list of chat ids.";
  return { deviceId: body.deviceId, chatIds: [...new Set(body.chatIds as string[])] };
}

/** POST /jobs/<id>/done body (desktop: deviceId; runner: runnerId). */
export function checkDone(body: unknown, who: "deviceId" | "runnerId"): { by: string; status: DoneStatusCore; error: string | null } | string {
  if (!isObject(body)) return "Invalid request.";
  if (!isId(body[who])) return `${who} is missing or invalid.`;
  if (typeof body.status !== "string" || !(DONE_STATUSES as readonly string[]).includes(body.status)) return "status must be done, failed or needs_computer.";
  const error = typeof body.error === "string" && body.error.trim() ? body.error.trim().slice(0, MAX_ERROR_TEXT) : null;
  return { by: body[who] as string, status: body.status as DoneStatusCore, error };
}

/** "<kind>:<deviceId>" from the x-oovi-device header; null when absent or invalid. Runners never come this way. */
export function parseDeviceHeader(v: string | null): { kind: "desktop" | "phone"; deviceId: string } | null {
  if (!v) return null;
  const m = /^(desktop|phone):(.+)$/.exec(v.trim());
  if (!m || !isId(m[2])) return null;
  return { kind: m[1] as "desktop" | "phone", deviceId: m[2]! };
}

/** Who holds a claim: "desktop:<deviceId>" or "runner:<runnerId>". */
export const claimer = (kind: "desktop" | "runner", id: string) => `${kind}:${id}`;

/** The account's new total after replacing a chat of `oldBytes` with one of `newBytes`; "over" past the limit. Shrinking is always allowed. */
export function quotaAfter(totalBytes: number, oldBytes: number, newBytes: number, limit = ACCOUNT_LIMIT_BYTES): number | "over" {
  const next = Math.max(0, totalBytes - oldBytes) + newBytes;
  if (newBytes > oldBytes && next > limit) return "over";
  return next;
}

/** A date sent as ?since= / ?jobsAfter=; null when absent, "bad" when it isn't a date. */
export function parseSince(v: string | null): Date | null | "bad" {
  if (v === null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() < 0 ? "bad" : d;
}

/**
 * The runner's secret check. Missing or short RUNNER_SECRET = the runner API is off. Compared in constant time
 * (both sides hashed first, so their lengths never show).
 */
export function runnerAuth(header: string | null, secret: string | undefined): "off" | "denied" | "ok" {
  if (!secret || secret.length < 32) return "off";
  if (!header) return "denied";
  const a = crypto.createHash("sha256").update(header, "utf8").digest();
  const b = crypto.createHash("sha256").update(secret, "utf8").digest();
  return crypto.timingSafeEqual(a, b) ? "ok" : "denied";
}

/** A short code for logs: never the error's text (it could quote data). */
export function logCode(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown } | null;
  if (e && typeof e.code === "string" && /^[A-Za-z0-9_]{1,20}$/.test(e.code)) return e.code;
  if (e && typeof e.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name)) return e.name;
  return "error";
}

/** 3.4 MB, 820 KB, 0 B: for Settings and the admin console. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return mb < 1024 ? `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/** The admin's one-line view of an account's sync: counts and sizes only, never content. */
export function syncCell(s: { enabled: boolean; chats: number; bytes: number } | null | undefined): string {
  if (!s || !s.enabled) return "No";
  return `Yes · ${s.chats} ${s.chats === 1 ? "chat" : "chats"} · ${fmtBytes(s.bytes)}`;
}

/**
 * Writes made with the website's cookie must come from the website itself (the phone app is same-origin). No
 * Origin header (the desktop app, the runner, curl) passes: those use a token, which another site can't send.
 */
export function sameOrigin(method: string, origin: string | null, ownHosts: string[]): boolean {
  if (method === "GET" || method === "HEAD" || !origin) return true;
  try {
    return ownHosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}

// ---------- connectors from the phone (sign-in through the website, connector keys) ----------

/** A sign-in started on the phone must come back within 10 minutes, once. */
export const OAUTH_FLOW_SECONDS = 600;
export const MAX_OPEN_FLOWS = 20;

/**
 * True when a value in a connector's settings looks like an AI MODEL key (Anthropic, OpenAI, OpenRouter, Groq,
 * xAI): those never leave the computer (docs/CLOUD-BUILD.md). Keys that belong to a connector are fine. Google keys
 * (AIza…) can't be told apart from a Maps or YouTube connector key, so they are not refused here; the app never
 * sends its Gemini key.
 */
export function looksLikeAiKey(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === "string") {
    const v = value.trim();
    return /^(sk-ant-|sk-proj-|sk-or-v1-|sk-svcacct-|gsk_|xai-)[A-Za-z0-9_-]{16,}$/.test(v) || /^sk-[A-Za-z0-9]{40,}$/.test(v);
  }
  if (Array.isArray(value)) return value.some((x) => looksLikeAiKey(x, depth + 1));
  if (value && typeof value === "object") return Object.values(value).some((x) => looksLikeAiKey(x, depth + 1));
  return false;
}

/** Addresses the server must never call on a user's behalf: this machine, private networks, link-local, cloud metadata. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateAddress(mapped[1]!);
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && Number(m[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (!v.includes(":")) return true; // not an address at all: refuse
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}

/**
 * A connector's address the website may call for a sign-in: https on a public name. `testHosts` (only from the
 * test environment variable) allows plain http to those hosts.
 */
export function checkConnectorUrl(raw: unknown, testHosts: string[] = []): URL | string {
  if (typeof raw !== "string" || raw.length > 2000) return "The connector's address is missing.";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "The connector's address isn't valid.";
  }
  if (u.username || u.password) return "The connector's address can't hold a password.";
  if (testHosts.includes(u.host) && (u.protocol === "http:" || u.protocol === "https:")) return u;
  if (u.protocol !== "https:") return "The connector's address must start with https://.";
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":") || u.hostname.startsWith("[")) {
    return "The connector's address must be a public website.";
  }
  return u;
}

/** Where to send the phone back after a sign-in. */
export function connectorsReturn(connectorId: string | null, outcome: { ok: true } | { error: "expired" | "denied" | "failed" | "signed_out" | "sync_off" }): string {
  const q = new URLSearchParams();
  if ("ok" in outcome) q.set("connected", connectorId ?? "");
  else {
    q.set("error", outcome.error);
    if (connectorId) q.set("id", connectorId);
  }
  return `/m/connectors?${q.toString()}`;
}

// ---------- a sign-in that comes back to a browser without the starting session (iPhone home-screen app) ----------

/** o***@gmail.com: enough for a person to notice it isn't their account, not enough to read it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export type PageLang = "ar" | "fr" | "en";
/** The page's language from the browser's Accept-Language (Arabic, French, else English). */
export function pickLang(acceptLanguage: string | null): PageLang {
  for (const part of (acceptLanguage ?? "").toLowerCase().split(",")) {
    const tag = part.trim().slice(0, 2);
    if (tag === "ar" || tag === "fr" || tag === "en") return tag;
  }
  return "en";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const HOLD_TEXT: Record<PageLang, { title: string; lead: string; other: string; yes: string; notYou: string; back: string; gone: string }> = {
  en: {
    title: "Finish connecting {service}",
    lead: "This connects {service} to the oovi account {email}.",
    other: "You are signed in here with a different oovi account.",
    yes: "Yes, it's my account",
    notYou: "Not you? Close this page: nothing will be connected.",
    back: "Go back to the oovi app to finish connecting {service}.",
    gone: "This sign-in has expired or was already used. Start again in the oovi app.",
  },
  fr: {
    title: "Terminer la connexion de {service}",
    lead: "Ceci connecte {service} au compte oovi {email}.",
    other: "Vous êtes connecté ici avec un autre compte oovi.",
    yes: "Oui, c'est mon compte",
    notYou: "Ce n'est pas vous ? Fermez cette page : rien ne sera connecté.",
    back: "Retournez dans l'app oovi pour terminer la connexion de {service}.",
    gone: "Cette connexion a expiré ou a déjà été utilisée. Recommencez dans l'app oovi.",
  },
  ar: {
    title: "إكمال ربط {service}",
    lead: "سيُربط {service} بحساب oovi ‏{email}.",
    other: "أنت مسجّل هنا بحساب oovi آخر.",
    yes: "نعم، هذا حسابي",
    notYou: "لست أنت؟ أغلق هذه الصفحة: لن يُربط أي شيء.",
    back: "ارجع إلى تطبيق oovi لإكمال ربط {service}.",
    gone: "انتهت صلاحية تسجيل الدخول هذا أو استُعمل من قبل. ابدأ من جديد في تطبيق oovi.",
  },
};

/**
 * The small page shown where the sign-in came back without the session that started it. "ask": the account (masked)
 * and one button that confirms it; "done": go back to the app; "gone": expired. Everything is escaped; no script.
 */
export function holdPageHtml(o: { lang: PageLang; step: "ask" | "done" | "gone"; service?: string; email?: string; otherAccount?: boolean; holdToken?: string; action?: string }): string {
  const t = HOLD_TEXT[o.lang];
  const fill = (s: string) => esc(s).replace("{service}", `<b>${esc(o.service ?? "")}</b>`).replace("{email}", `<b dir="ltr">${esc(o.email ?? "")}</b>`);
  let main: string;
  if (o.step === "ask") {
    main = `<h1>${fill(t.title)}</h1><p>${fill(t.lead)}</p>${o.otherAccount ? `<p class="warn">${fill(t.other)}</p>` : ""}
<form method="post" action="${esc(o.action ?? "")}"><input type="hidden" name="hold" value="${esc(o.holdToken ?? "")}"><button type="submit">${fill(t.yes)}</button></form>
<p class="small">${fill(t.notYou)}</p>`;
  } else if (o.step === "done") main = `<h1>✓</h1><p>${fill(t.back)}</p>`;
  else main = `<p>${fill(t.gone)}</p>`;
  return `<!doctype html><html lang="${o.lang}" dir="${o.lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>oovi</title>
<style>body{font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:48px 20px;background:#f5f5f7;color:#1d1d1f}main{max-width:420px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 12px}button{width:100%;font:inherit;font-weight:600;padding:14px;border:0;border-radius:12px;background:#007aff;color:#fff;margin:8px 0}.warn{color:#b3261e}.small{font-size:14px;color:#6e6e73}@media (prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}main{background:#1c1c1e}.small{color:#98989d}.warn{color:#ff6961}}</style></head><body><main>${main}</main></body></html>`;
}
