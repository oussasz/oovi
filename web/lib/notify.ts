// Notifications to the owner: an email to the addresses chosen in Admin > Email when something happens
// (new account, order, refund, feedback...). What is sent and who gets it is saved in app_config
// ("notifications") and edited in the console.
// Rules: a notification can never break the thing it reports on (every function here swallows its
// errors and is called after the response), and a burst can't flood the inbox (cap per kind per hour).
import { pool } from "./db";
import { isEmail, sendMail, sendMailQuietly } from "./mail";
import { adminNotice } from "./mail-templates";

export const EVENTS = [
  { key: "newUser", label: "New account", help: "Someone signs up.", on: true },
  { key: "order", label: "New order or renewal", help: "A payment goes through (a new subscription or a renewal).", on: true },
  { key: "refund", label: "Refund or chargeback", help: "Money goes back to a customer.", on: true },
  { key: "cancel", label: "Subscription canceled", help: "A customer cancels their plan.", on: true },
  { key: "feedback", label: "New feedback", help: "A problem or an idea sent from the app or the website.", on: true },
  { key: "pilotRequest", label: "New pilot request", help: "Someone asks to join the pilot.", on: true },
  { key: "capacity", label: "theOovi paused: daily budget reached", help: "The daily AI budget ran out, so theOovi stops until midnight UTC.", on: true },
  { key: "providerError", label: "theOovi down: AI key rejected", help: "The AI provider refused your key, so theOovi can't answer anyone.", on: true },
  { key: "crash", label: "New crash report", help: "The desktop app crashed for someone. Can be frequent.", on: false },
] as const;

export type EventKey = (typeof EVENTS)[number]["key"];
export type NotifyConfig = { enabled: boolean; recipients: string[]; events: Record<EventKey, boolean> };
export type Notice = {
  event: EventKey;
  title: string;
  lead: string;
  rows?: [string, string][];
  /** A longer text shown on its own (a message someone wrote). */
  quote?: string;
  button?: { label: string; path: string };
};

const MAX_RECIPIENTS = 10;
/** At most this many notifications of one kind per hour; the rest are held back (one notice says so). */
const HOURLY_CAP = 30;

export const DEFAULT_NOTIFY: NotifyConfig = {
  enabled: true,
  recipients: [],
  events: Object.fromEntries(EVENTS.map((e) => [e.key, e.on])) as Record<EventKey, boolean>,
};

export function normalizeNotify(raw: unknown): NotifyConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ev = (r.events && typeof r.events === "object" ? r.events : {}) as Record<string, unknown>;
  const events = { ...DEFAULT_NOTIFY.events };
  for (const e of EVENTS) if (typeof ev[e.key] === "boolean") events[e.key] = ev[e.key] as boolean;
  const list = Array.isArray(r.recipients) ? r.recipients : [];
  const recipients: string[] = [];
  for (const x of list) {
    const v = typeof x === "string" ? x.trim().toLowerCase() : "";
    if (v && isEmail(v) && !recipients.includes(v)) recipients.push(v);
    if (recipients.length >= MAX_RECIPIENTS) break;
  }
  return { enabled: typeof r.enabled === "boolean" ? r.enabled : true, recipients, events };
}

/** The admins from ADMIN_EMAILS: they receive notifications while no list has been saved. */
export function adminList(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && isEmail(e));
}

export const effectiveRecipients = (cfg: NotifyConfig) => (cfg.recipients.length ? cfg.recipients : adminList());

const g = globalThis as typeof globalThis & { __ooviNotify?: { at: number; cfg: NotifyConfig } };
const TTL = 15_000;

export async function getNotifyConfig(): Promise<NotifyConfig> {
  const c = g.__ooviNotify;
  if (c && Date.now() - c.at < TTL) return c.cfg;
  let cfg = DEFAULT_NOTIFY;
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'notifications'");
    if (rows[0]) cfg = normalizeNotify(rows[0].value);
  } catch (err) {
    if (c) return c.cfg;
    console.error("notification settings read failed", err instanceof Error ? err.message : err);
  }
  g.__ooviNotify = { at: Date.now(), cfg };
  return cfg;
}

export async function saveNotifyConfig(cfg: NotifyConfig, by: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('notifications', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(normalizeNotify(cfg)), by],
  );
  g.__ooviNotify = undefined;
}

const buckets = new Map<string, { n: number; resetAt: number }>();
/** "ok", "last" (the one that announces the hold-back) or "drop". */
function takeSlot(event: EventKey): "ok" | "last" | "drop" {
  const now = Date.now();
  const b = buckets.get(event);
  if (!b || b.resetAt <= now) {
    buckets.set(event, { n: 1, resetAt: now + 3_600_000 });
    return "ok";
  }
  b.n += 1;
  return b.n <= HOURLY_CAP ? "ok" : b.n === HOURLY_CAP + 1 ? "last" : "drop";
}

const label = (k: EventKey) => EVENTS.find((e) => e.key === k)?.label ?? k;

/** Sends one notification to everyone chosen, if this kind is switched on. Never throws. */
export async function notify(n: Notice): Promise<void> {
  try {
    const cfg = await getNotifyConfig();
    if (!cfg.enabled || !cfg.events[n.event]) return;
    const to = effectiveRecipients(cfg);
    if (!to.length) return;
    const slot = takeSlot(n.event);
    if (slot === "drop") return;
    const notice: Notice =
      slot === "last"
        ? {
            event: n.event,
            title: `Many “${label(n.event)}” notifications`,
            lead: `More than ${HOURLY_CAP} in the last hour. The rest are held back until the hour ends so your inbox isn't flooded. Everything is still recorded in the console.`,
            button: n.button,
          }
        : n;
    for (const r of to) await sendMailQuietly(adminNotice(r, notice));
  } catch (err) {
    console.error("notification failed:", err instanceof Error ? err.message : err);
  }
}

const once = new Map<string, number>();
/** Like notify, but only once per `ttlMs` for the same key (for "the service is down" alerts that would repeat). */
export async function notifyOnce(key: string, ttlMs: number, n: Notice): Promise<void> {
  const now = Date.now();
  if ((once.get(key) ?? 0) > now) return;
  once.set(key, now + ttlMs);
  if (once.size > 200) for (const [k, t] of once) if (t <= now) once.delete(k);
  await notify(n);
}

/** For the "Send a test" button: sends to the chosen addresses whatever is switched on, and says what went wrong. */
export async function sendTestNotice(): Promise<{ sent: string[] }> {
  const cfg = await getNotifyConfig();
  const to = effectiveRecipients(cfg);
  if (!to.length) throw new Error("No address to send to. Add one above (or set ADMIN_EMAILS).");
  const notice: Notice = {
    event: "newUser",
    title: "Test notification",
    lead: "This is a test. If you're reading it, notifications reach this address.",
    rows: [["Sent from", "Admin › Email"]],
    button: { label: "Open the console", path: "/admin/email" },
  };
  for (const r of to) await sendMail(adminNotice(r, notice));
  return { sent: to };
}
