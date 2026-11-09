"use client";

// theOovi in the interface: the credits chip (balance + today's limit with its reset
// time), the notice under a reply that couldn't run (no credits, limit reached,
// offline…), the offline banner and the feedback dialog.
import { useCallback, useEffect, useState } from "react";
import type { HostedStatus } from "@/lib/hosted";
import { useI18n } from "./I18n";
import Icon from "./Icon";
import { openSettings } from "./SettingsModal";

type Loaded = HostedStatus | null;

const EVENT = "oovi:credits";
/** Ask every credits view to reload (after a reply finished…). */
export const refreshCredits = () => window.dispatchEvent(new Event(EVENT));

export function useHosted(): { status: Loaded; reload: (fresh?: boolean) => Promise<void> } {
  const [status, setStatus] = useState<Loaded>(null);
  const reload = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`/api/credits${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const j = (await r.json()) as HostedStatus | { signedIn: false };
      setStatus("state" in j ? j : null);
    } catch {
      /* the local server is restarting; keep what we have */
    }
  }, []);
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 60_000);
    const on = () => void reload();
    const fresh = () => void reload(true);
    window.addEventListener(EVENT, on);
    window.addEventListener("online", fresh);
    window.addEventListener("focus", on);
    return () => {
      clearInterval(t);
      window.removeEventListener(EVENT, on);
      window.removeEventListener("online", fresh);
      window.removeEventListener("focus", on);
    };
  }, [reload]);
  return { status, reload };
}

const fmt = (n: number, tag: string) => new Intl.NumberFormat(tag, { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);

function untilReset(iso: string): { h: number; m: number } {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  return { h: Math.floor(ms / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) };
}

/** Sends the email confirmation link again (free credits wait for it). */
function ResendButton({ primary = false }: { primary?: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function send() {
    setState("sending");
    try {
      const r = await fetch("/api/account/verify", { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { error?: string; alreadyVerified?: boolean };
      if (!r.ok) throw new Error(j.error || t("credits.resendFailed"));
      setState("sent");
      setMsg(j.alreadyVerified ? t("credits.alreadyVerified") : t("credits.resent"));
      if (j.alreadyVerified) refreshCredits();
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  }
  return (
    <>
      <button type="button" className={`btn sm${primary ? " primary" : ""}`} disabled={state === "sending" || state === "sent"} onClick={() => void send()}>
        {state === "sending" ? t("credits.resending") : t("credits.resend")}
      </button>
      {msg && <span className={`fine${state === "error" ? " err" : ""}`} role="status">{msg}</span>}
    </>
  );
}

/** The credits chip at the bottom of the sidebar, with a details panel. */
export function CreditsChip() {
  const { t, tag } = useI18n();
  const { status, reload } = useHosted();
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (!status) return null;

  const limit = status.dailyLimit;
  const pct = limit > 0 ? Math.min(100, Math.round((status.dailyUsed / limit) * 100)) : 0;
  const reset = untilReset(status.resetsAt);
  const offline = status.state === "offline";
  // The daily limit is a safety cap: only surface it when someone gets close.
  const nearCap = limit > 0 && pct >= 80;
  const warn = !offline && (status.state !== "ok" || nearCap);
  const showPilot = !!status.pilot.public && status.pilot.eligible && !status.pilot.status && !!status.links.pilot;

  return (
    <div className="credits">
      <button
        type="button"
        className={`credits-chip${warn ? " warn" : ""}${offline ? " off" : ""}`}
        onClick={() => {
          setOpen(!open);
          if (!open) void reload(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("credits.title", { name: status.displayName })}
      >
        <Icon name="spark" size={15} />
        <span className="credits-num">
          <b>{fmt(status.balance, tag)}</b> {t("credits.unit")}
        </span>
        {offline && <span className="credits-dot" aria-hidden />}
      </button>
      {open && (
        <>
          <div className="credits-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="credits-pop" role="dialog" aria-label={t("credits.title", { name: status.displayName })}>
            <div className="credits-head">
              <span>{status.displayName}</span>
              <span className="tag">{status.plan.name}</span>
            </div>
            <div className="credits-big">
              <b>{fmt(status.balance, tag)}</b>
              <span>{t("credits.left")}</span>
            </div>
            {offline ? (
              <p className="credits-msg">{t("credits.offline")}</p>
            ) : (
              status.message && <p className="credits-msg">{status.message}</p>
            )}
            {limit > 0 && (
              <div className={`credits-cap${nearCap ? " near" : ""}`}>
                <div className="credits-cap-row">
                  <span>{t("credits.today")}</span>
                  <span>{t("credits.todayOf", { used: fmt(Math.min(status.dailyUsed, limit), tag), limit: fmt(limit, tag) })}</span>
                </div>
                <div className="credits-meter" aria-hidden>
                  <span style={{ width: `${Math.max(pct, status.dailyUsed > 0 ? 2 : 0)}%` }} />
                </div>
                <div className="credits-cap-row fine">
                  <span>{t("credits.resetsIn", { h: reset.h, m: reset.m })}</span>
                </div>
              </div>
            )}
            <p className="fine">{t("credits.explain")}</p>
            {status.state === "verify_email" && (
              <div className="credits-actions">
                <ResendButton primary />
              </div>
            )}
            <div className="credits-actions">
              {status.links.subscribe && (
                <a className="btn primary sm" href={status.links.subscribe} target="_blank" rel="noreferrer">
                  {t("credits.subscribe")}
                </a>
              )}
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setOpen(false);
                  openSettings("models");
                }}
              >
                {t("credits.ownKey")}
              </button>
            </div>
            {showPilot && (
              <a className="credits-link" href={status.links.pilot} target="_blank" rel="noreferrer">
                {t("credits.pilot", { n: fmt(status.pilot.credits, tag) })} →
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Shown under a reply theOovi couldn't run, with the way forward. */
export function HostedNotice({ code, message }: { code: string; message?: string }) {
  const { t } = useI18n();
  const { status } = useHosted();
  const links = status?.links;
  const reset = status ? untilReset(status.resetsAt) : null;
  const text =
    code === "no_credits"
      ? t("credits.outTitle")
      : code === "daily_limit"
        ? t("credits.limitTitle", { h: reset?.h ?? 0, m: reset?.m ?? 0 })
        : code === "offline"
          ? t("credits.offlineTitle")
          : code === "signed_out"
            ? t("credits.signedOut")
            : code === "verify_email"
              ? t("credits.verifyTitle")
              : (message ?? "");
  return (
    <div className={`hosted-notice${code === "no_credits" ? " strong" : ""}`}>
      <p>{text}</p>
      {code === "verify_email" && (
        <div className="credits-actions">
          <ResendButton primary />
        </div>
      )}
      {code !== "offline" && code !== "signed_out" && code !== "verify_email" && (
        <div className="credits-actions">
          {code === "no_credits" && links?.subscribe && (
            <a className="btn primary sm" href={links.subscribe} target="_blank" rel="noreferrer">
              {t("credits.subscribe")}
            </a>
          )}
          <button type="button" className="btn sm" onClick={() => openSettings("models")}>
            {t("credits.ownKey")}
          </button>
        </div>
      )}
    </div>
  );
}

/** A thin banner while the computer has no internet connection. */
export function OfflineBanner() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="globe" size={15} /> {t("offline.banner")}
    </div>
  );
}

/** Problem reports and ideas, sent to the oovi team. */
export function FeedbackButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"problem" | "improvement" | "other">("problem");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, message }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(r.status === 503 ? t("feedback.offline") : j.error || t("feedback.failed"));
      setState("sent");
      setMessage("");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  return (
    <>
      <button
        type="button"
        className="side-settings side-feedback"
        onClick={() => {
          setOpen(true);
          setState("idle");
          setError(null);
        }}
      >
        <Icon name="bulb" /> {t("feedback.button")}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="feedback-window" role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="fb-title">{t("feedback.title")}</h2>
            {state === "sent" ? (
              <>
                <p>{t("feedback.thanks")}</p>
                <div className="credits-actions">
                  <button type="button" className="btn primary sm" onClick={() => setOpen(false)}>
                    {t("feedback.close")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="fine">{t("feedback.sub")}</p>
                <div className="chip-row" role="radiogroup" aria-label={t("feedback.kind")}>
                  {(["problem", "improvement", "other"] as const).map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>
                      {t(`feedback.${k}`)}
                    </button>
                  ))}
                </div>
                <label className="sr-only" htmlFor="fb-msg">
                  {t("feedback.message")}
                </label>
                <textarea
                  id="fb-msg"
                  className="input"
                  rows={6}
                  maxLength={5000}
                  value={message}
                  placeholder={kind === "problem" ? t("feedback.problemHint") : t("feedback.ideaHint")}
                  onChange={(e) => setMessage(e.target.value)}
                />
                {error && <div className="notice error small">{error}</div>}
                <div className="credits-actions">
                  <button type="button" className="btn primary sm" disabled={state === "sending" || message.trim().length < 5} onClick={() => void send()}>
                    {state === "sending" ? t("feedback.sending") : t("feedback.send")}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setOpen(false)}>
                    {t("feedback.cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
