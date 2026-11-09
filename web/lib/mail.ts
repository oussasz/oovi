// Email through the owner's own SMTP server, set up in the admin console (/admin/email).
// The password is stored encrypted (same AES-256-GCM as the AI key) and is never sent to
// a browser. Every message is sent with file and URL access disabled.
import nodemailer from "nodemailer";
import { after } from "next/server";
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";

export type SmtpConfig = {
  host: string;
  port: number;
  /** "ssl" = encrypted from the start (usually port 465). "starttls" = upgrade after connecting (usually 587). */
  security: "ssl" | "starttls";
  user: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  /** Free theOovi credits only work after the email address is confirmed. */
  requireVerified: boolean;
};

export const DEFAULT_SMTP: SmtpConfig = {
  host: "",
  port: 465,
  security: "ssl",
  user: "",
  fromName: "oovi",
  fromEmail: "",
  replyTo: "contact@conuron.com",
  requireVerified: true,
};

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
export const isEmail = (v: string) => EMAIL.test(v) && v.length <= 254;
const HOST = /^[a-zA-Z0-9.-]{1,253}$/;

export function normalizeSmtp(raw: unknown): SmtpConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max = 254) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const port = typeof r.port === "number" && Number.isInteger(r.port) && r.port > 0 && r.port < 65536 ? r.port : DEFAULT_SMTP.port;
  const host = s(r.host);
  const fromEmail = s(r.fromEmail);
  const replyTo = s(r.replyTo);
  return {
    host: HOST.test(host) ? host : "",
    port,
    security: r.security === "starttls" ? "starttls" : "ssl",
    user: s(r.user),
    // Names go into a header: keep them to one plain line.
    fromName: s(r.fromName, 60).replace(/[\r\n"<>]/g, "") || DEFAULT_SMTP.fromName,
    fromEmail: isEmail(fromEmail) ? fromEmail : "",
    replyTo: isEmail(replyTo) ? replyTo : "",
    requireVerified: typeof r.requireVerified === "boolean" ? r.requireVerified : DEFAULT_SMTP.requireVerified,
  };
}

type Loaded = { cfg: SmtpConfig; password: string | null; updatedAt: string | null; at: number };
const g = globalThis as typeof globalThis & { __ooviSmtp?: Loaded };

async function load(): Promise<Loaded> {
  const c = g.__ooviSmtp;
  if (c && Date.now() - c.at < 15_000) return c;
  let cfg = DEFAULT_SMTP;
  let password: string | null = null;
  let updatedAt: string | null = null;
  try {
    const { rows } = await pool.query<{ key: string; value: unknown; updated_at: Date }>(
      "SELECT key, value, updated_at FROM app_config WHERE key IN ('smtp', 'smtp_secret')",
    );
    const conf = rows.find((r) => r.key === "smtp");
    if (conf) {
      cfg = normalizeSmtp(conf.value);
      updatedAt = new Date(conf.updated_at).toISOString();
    }
    const sec = rows.find((r) => r.key === "smtp_secret")?.value as Sealed | undefined;
    if (sec?.data) password = unsealSecret(sec);
  } catch (err) {
    if (c) return c;
    console.error("smtp settings read failed", err instanceof Error ? err.message : "unknown error");
  }
  const next = { cfg, password, updatedAt, at: Date.now() };
  g.__ooviSmtp = next;
  return next;
}

/** Ready to send: server, sender address and password are all set. */
const ready = (l: Loaded) => !!(l.cfg.host && l.cfg.fromEmail && l.cfg.user && l.password);

export async function smtpStatus(): Promise<{ cfg: SmtpConfig; hasPassword: boolean; ready: boolean; updatedAt: string | null }> {
  const l = await load();
  return { cfg: l.cfg, hasPassword: !!l.password, ready: ready(l), updatedAt: l.updatedAt };
}

/** Email confirmation is enforced only when it's switched on AND email can actually be sent. */
export async function verificationRequired(): Promise<boolean> {
  const l = await load();
  return l.cfg.requireVerified && ready(l);
}

/** password: a new one to store, null to remove it, undefined to keep the current one. */
export async function saveSmtp(cfg: SmtpConfig, password: string | null | undefined, by: string): Promise<void> {
  const upsert = `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ($1, $2::jsonb, now(), $3)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  await pool.query(upsert, ["smtp", JSON.stringify(normalizeSmtp(cfg)), by]);
  if (password === null) await pool.query("DELETE FROM app_config WHERE key = 'smtp_secret'");
  else if (typeof password === "string") await pool.query(upsert, ["smtp_secret", JSON.stringify(sealSecret(password)), by]);
  g.__ooviSmtp = undefined;
}

export type Mail = { to: string; subject: string; html: string; text: string };

/** Sends one email. Throws a plain-English error (never containing the password). */
export async function sendMail(m: Mail): Promise<void> {
  const l = await load();
  if (!ready(l)) throw new Error("Email isn't set up yet. Add the SMTP settings in the admin console.");
  if (!isEmail(m.to)) throw new Error("That email address doesn't look right.");
  const t = nodemailer.createTransport({
    host: l.cfg.host,
    port: l.cfg.port,
    secure: l.cfg.security === "ssl",
    requireTLS: l.cfg.security === "starttls",
    auth: { user: l.cfg.user, pass: l.password! },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await t.sendMail({
      from: { name: l.cfg.fromName, address: l.cfg.fromEmail },
      to: m.to,
      ...(l.cfg.replyTo ? { replyTo: l.cfg.replyTo } : {}),
      subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
      html: m.html,
      text: m.text,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch (err) {
    const e = err as { code?: string; responseCode?: number };
    console.error("email send failed", e.code ?? "", e.responseCode ?? "");
    if (e.code === "EAUTH" || e.responseCode === 535) throw new Error("The mail server refused the email or password. Check them in the console.");
    if (e.code === "ESOCKET" || e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "EDNS")
      throw new Error("Couldn't connect to the mail server. Check the server name, port and security setting.");
    throw new Error(`The mail server didn't accept the email${e.responseCode ? ` (code ${e.responseCode})` : ""}.`);
  } finally {
    t.close();
  }
}

/**
 * Sends after the response has gone out, so a slow or unreachable mail server never
 * delays sign-up or password reset. Outside a request (scripts) it just sends.
 */
export function sendInBackground(m: Mail): void {
  const job = () => sendMailQuietly(m).then(() => undefined);
  try {
    after(job);
  } catch {
    void job();
  }
}

/** Sends without failing the caller (sign-up, approvals…); problems are logged. */
export async function sendMailQuietly(m: Mail): Promise<boolean> {
  try {
    await sendMail(m);
    return true;
  } catch (err) {
    console.error("email not sent:", err instanceof Error ? err.message : "unknown error");
    return false;
  }
}
