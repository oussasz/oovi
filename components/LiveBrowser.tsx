"use client";

// The bot's browser, live, in the chat's side panel. The user watches, or takes control
// to sign in or solve a CAPTCHA, then hands it back. While watching, input is ignored.
// While in control, pointer and keyboard input go to the page (normalized coordinates,
// keys in Playwright format, typed text including IME and pastes). The bot is paused.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { LiveSessionInfo, TakeoverRequest } from "@/lib/browser-live";
import { api } from "@/lib/client";
import type { Bot } from "@/lib/types";
import Face from "./Face";
import Icon from "./Icon";
import { useI18n } from "./I18n";

type Meta = { url: string; title: string; controlled: boolean; request?: TakeoverRequest; w: number; h: number };
type Status = "connecting" | "live" | "reconnecting" | "ended";
type InputEv =
  | { type: "mouse"; action: "down" | "up" | "move"; x: number; y: number; button: "left" | "right" | "middle"; clickCount?: number }
  | { type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { type: "key"; key: string }
  | { type: "text"; text: string };
type Msg = { type: "frame"; data: string; w: number; h: number; url: string; title: string; controlled: boolean; request?: TakeoverRequest } | { type: "state"; url: string; title: string; controlled: boolean; request?: TakeoverRequest } | { type: "end" } | { type: "ping" };

const MAX_TEXT = 2000;
const MOVE_EVERY_MS = 40;
const NAMED_KEYS = new Set([
  "Enter", "Backspace", "Tab", "Escape", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
]);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const BUTTONS = ["left", "middle", "right"] as const;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** A key press in Playwright format ("Enter", "Shift+Tab", "Control+A"), or null if it's typed text. */
function keyCombo(e: ReactKeyboardEvent): string | null {
  const altGr = e.getModifierState("AltGraph");
  const key = e.key === " " ? "Space" : e.key;
  const isChar = [...e.key].length === 1;
  const ctrl = e.ctrlKey && !altGr;
  const alt = e.altKey && !altGr;
  if (isChar && !ctrl && !alt && !e.metaKey) return null; // typed text: arrives through the input event
  if (!isChar && !NAMED_KEYS.has(key)) return null; // lone modifiers, media keys…
  const mods = [ctrl && "Control", alt && "Alt", e.metaKey && "Meta", e.shiftKey && (!isChar || ctrl || alt || e.metaKey) && "Shift"].filter(Boolean);
  return [...mods, isChar ? (key === "Space" ? "Space" : e.key) : key].join("+");
}

export default function LiveBrowser({ chatId, sessions, bots, onChange }: { chatId: string; sessions: LiveSessionInfo[]; bots: Bot[]; onChange: () => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const requested = sessions.find((s) => s.request);
  const controlled = sessions.find((s) => s.controlled);
  const active = sessions.find((s) => s.botId === picked) ?? controlled ?? requested ?? sessions[0];

  // A bot asking for help gets its tab shown, unless the user is busy in another one.
  const reqKey = requested ? `${requested.botId}:${requested.request?.at}` : "";
  useEffect(() => {
    if (requested && !controlled) setPicked(requested.botId);
  }, [reqKey]); // only when a new request arrives

  if (!active) return null;
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? t("common.bot");

  return (
    <div className="lb-wrap">
      {sessions.length > 1 && (
        <div className="lb-tabs" role="tablist" aria-label={t("live.tabs")}>
          {sessions.map((s) => {
            const b = bots.find((x) => x.id === s.botId);
            const on = s.botId === active.botId;
            return (
              <button
                key={s.botId}
                role="tab"
                id={`lb-tab-${s.botId}`}
                aria-selected={on}
                aria-controls="lb-panel"
                tabIndex={on ? 0 : -1}
                className={`lb-tab${on ? " on" : ""}${s.request ? " ask" : ""}`}
                onClick={() => setPicked(s.botId)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
                  const step = (e.key === "ArrowRight") !== rtl ? 1 : -1;
                  const i = sessions.findIndex((x) => x.botId === s.botId);
                  const next = sessions[(i + step + sessions.length) % sessions.length];
                  if (next) {
                    setPicked(next.botId);
                    document.getElementById(`lb-tab-${next.botId}`)?.focus();
                  }
                }}
              >
                {b && <Face face={b.face} size={18} />}
                <span>{nameOf(s.botId)}</span>
                {s.request && <span className="lb-tab-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      <div id="lb-panel" role={sessions.length > 1 ? "tabpanel" : undefined} aria-labelledby={sessions.length > 1 ? `lb-tab-${active.botId}` : undefined}>
        <LiveView key={active.botId} chatId={chatId} info={active} bot={bots.find((b) => b.id === active.botId)} name={nameOf(active.botId)} onChange={onChange} />
      </div>
    </div>
  );
}

function LiveView({ chatId, info, bot, name, onChange }: { chatId: string; info: LiveSessionInfo; bot?: Bot; name: string; onChange: () => void }) {
  const { t } = useI18n();
  const botId = info.botId;
  const [meta, setMeta] = useState<Meta>({ url: info.url, title: info.title, controlled: info.controlled, request: info.request, w: 1280, h: 800 });
  const [status, setStatus] = useState<Status>("connecting");
  const [hasFrame, setHasFrame] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const visible = useDocumentVisible();

  const imgRef = useRef<HTMLImageElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<HTMLTextAreaElement>(null);
  const takeRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const blobUrls = useRef<string[]>([]);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const statusRef = useRef(status);
  statusRef.current = status;
  const moveFocus = useRef<"keys" | "take" | null>(null);

  // The 3-second session poll fills in while the stream is (re)connecting.
  useEffect(() => {
    if (statusRef.current === "live") return;
    setMeta((m) => ({ ...m, url: info.url || m.url, title: info.title || m.title, controlled: info.controlled, request: info.request }));
  }, [info.url, info.title, info.controlled, info.request]);

  const drawFrame = useCallback((data: string) => {
    const img = imgRef.current;
    if (!img) return;
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    blobUrls.current.push(url);
    // Once the newest frame is shown (or failed), free every older one.
    const prune = () => {
      blobUrls.current = blobUrls.current.filter((u) => {
        if (u === url) return true;
        URL.revokeObjectURL(u);
        return false;
      });
    };
    img.onload = prune;
    img.onerror = prune;
    img.src = url;
  }, []);

  useEffect(
    () => () => {
      for (const u of blobUrls.current) URL.revokeObjectURL(u);
      blobUrls.current = [];
    },
    [],
  );

  // The stream: only while this view is shown and the window is visible.
  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = 0;
    const apply = (m: Msg) => {
      if (m.type === "ping") return;
      if (m.type === "end") {
        setStatus("ended");
        stopped = true;
        onChange();
        return;
      }
      if (m.type === "frame") {
        drawFrame(m.data);
        setHasFrame(true);
      }
      const cur = metaRef.current;
      const w = m.type === "frame" ? m.w : cur.w;
      const h = m.type === "frame" ? m.h : cur.h;
      if (cur.url !== m.url || cur.title !== m.title || cur.controlled !== m.controlled || cur.request?.at !== m.request?.at || cur.w !== w || cur.h !== h) {
        setMeta({ url: m.url, title: m.title, controlled: m.controlled, request: m.request, w, h });
      }
    };
    const run = async () => {
      ctrl = new AbortController();
      try {
        const res = await fetch(`/api/browser/live?chat=${encodeURIComponent(chatId)}&bot=${encodeURIComponent(botId)}`, { signal: ctrl.signal, cache: "no-store" });
        if (res.status === 404) {
          setStatus("ended");
          onChange();
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        setStatus("live");
        retry = 0;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) apply(JSON.parse(line) as Msg);
            if (stopped) return;
          }
        }
      } catch {
        /* network error or aborted */
      }
      if (stopped) return;
      setStatus("reconnecting");
      timer = setTimeout(() => void run(), Math.min(5_000, 500 * 2 ** retry++));
    };
    setStatus((s) => (s === "ended" ? s : "connecting"));
    void run();
    return () => {
      stopped = true;
      ctrl?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [chatId, botId, visible, drawFrame, onChange]);

  // Announce state changes for screen readers; move focus only after the user's own action.
  const prevCtl = useRef(meta.controlled);
  const prevReq = useRef(meta.request?.at);
  useEffect(() => {
    if (prevCtl.current !== meta.controlled) {
      setAnnounce(meta.controlled ? t("live.announceControl", { name }) : t("live.announceWatching", { name }));
      if (!meta.controlled) setExpanded(false);
      prevCtl.current = meta.controlled;
    } else if (meta.request && prevReq.current !== meta.request.at) {
      setAnnounce(t("live.announceRequest", { name, reason: meta.request.reason }));
    }
    prevReq.current = meta.request?.at;
  }, [meta.controlled, meta.request, name, t]);

  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (moveFocus.current === "keys" && meta.controlled) keysRef.current?.focus({ preventScroll: true });
    else if (moveFocus.current === "take" && !meta.controlled) takeRef.current?.focus({ preventScroll: true });
    else return;
    moveFocus.current = null;
  }, [focusTick, meta.controlled]);

  async function control(action: "take" | "release") {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ controlled: boolean; request?: TakeoverRequest }>("/api/browser/control", { method: "POST", body: JSON.stringify({ chat: chatId, bot: botId, action }) });
      moveFocus.current = action === "take" ? "keys" : "take";
      if (action === "take") setExpanded(true);
      setMeta((m) => ({ ...m, controlled: r.controlled, request: r.request }));
      setFocusTick((n) => n + 1);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- input (only while in control) ----------

  const queue = useRef<InputEv[]>([]);
  const sending = useRef(false);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let retries = 0;
    try {
      while (queue.current.length) {
        const batch = queue.current.splice(0, 20);
        const res = await fetch("/api/browser/input", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId, bot: botId, events: batch }) }).catch(() => null);
        if (res?.status === 429 && retries++ < 3) {
          queue.current.unshift(...batch);
          await new Promise((r) => setTimeout(r, 300));
        } else if (!res || res.status === 409 || res.status === 404) {
          queue.current = [];
        }
      }
    } finally {
      sending.current = false;
    }
  }, [chatId, botId]);

  const push = useCallback(
    (ev: InputEv) => {
      if (!metaRef.current.controlled) return;
      const q = queue.current;
      const last = q.at(-1);
      if (ev.type === "mouse" && ev.action === "move" && last?.type === "mouse" && last.action === "move") q[q.length - 1] = ev;
      else if (ev.type === "wheel" && last?.type === "wheel") q[q.length - 1] = { ...ev, dx: last.dx + ev.dx, dy: last.dy + ev.dy };
      else if (ev.type === "text" && last?.type === "text" && [...last.text].length + [...ev.text].length <= MAX_TEXT) q[q.length - 1] = { type: "text", text: last.text + ev.text };
      else q.push(ev);
      void flush();
    },
    [flush],
  );

  const pointAt = (clientX: number, clientY: number) => {
    const r = screenRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };

  const pressed = useRef<(typeof BUTTONS)[number] | null>(null);
  const lastMove = useRef(0);
  const lastDown = useRef({ at: 0, x: 0, y: 0, count: 0 });

  // Wheel needs a non-passive listener to keep the app from scrolling.
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!metaRef.current.controlled) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? metaRef.current.h : 1;
      push({ type: "wheel", ...pointAt(e.clientX, e.clientY), dx: e.deltaX * unit, dy: e.deltaY * unit });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [push]);

  function sendText(text: string) {
    const chars = [...text.replace(/\r\n?/g, "\n")];
    for (let i = 0; i < chars.length; i += MAX_TEXT) push({ type: "text", text: chars.slice(i, i + MAX_TEXT).join("") });
  }

  const composing = useRef(false);
  const ctl = meta.controlled;
  const live = status === "live" || status === "connecting";

  return (
    <div className={`lb${expanded ? " expanded" : ""}${ctl ? " ctl" : ""}`}>
      {expanded && <div className="lb-backdrop" aria-hidden="true" />}
      <div className="lb-box">
        <div className="lb-who">
          {bot && <Face face={bot.face} size={26} />}
          <div className="lb-who-text">
            <b>{name}</b>
            <span title={meta.title}>{meta.title || meta.url}</span>
          </div>
          <span className={`lb-chip${ctl ? " ctl" : ""}`}>
            <span className="lb-chip-dot" aria-hidden="true" />
            {ctl ? t("live.inControl") : t("live.watching")}
          </span>
          <button className="icon-btn sm" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? t("live.shrink") : t("live.expand")} title={expanded ? t("live.shrink") : t("live.expand")} aria-pressed={expanded}>
            <Icon name="expand" size={16} />
          </button>
        </div>

        <input className="lb-url" readOnly value={meta.url} aria-label={t("live.address")} dir="ltr" spellCheck={false} />

        {meta.request && !ctl && (
          <div className="lb-request">
            <Icon name="user" size={16} />
            <span>{t("live.needsYou", { name, reason: meta.request.reason })}</span>
            <button className="btn primary sm" onClick={() => void control("take")} disabled={busy || status === "ended"}>
              {t("live.take")}
            </button>
          </div>
        )}

        <div className="lb-stage">
          <div
            ref={screenRef}
            className={`lb-screen${ctl ? " ctl" : ""}`}
            style={{ "--lb-ar": `${meta.w} / ${meta.h}` } as CSSProperties}
            onPointerDown={(e) => {
              if (!ctl) return;
              e.preventDefault();
              keysRef.current?.focus({ preventScroll: true });
              const button = BUTTONS[e.button] ?? "left";
              const p = pointAt(e.clientX, e.clientY);
              const d = lastDown.current;
              const near = Math.abs(e.clientX - d.x) < 6 && Math.abs(e.clientY - d.y) < 6;
              const count = near && e.timeStamp - d.at < 500 ? Math.min(3, d.count + 1) : 1;
              lastDown.current = { at: e.timeStamp, x: e.clientX, y: e.clientY, count };
              pressed.current = button;
              e.currentTarget.setPointerCapture(e.pointerId);
              push({ type: "mouse", action: "down", ...p, button, clickCount: count });
            }}
            onPointerMove={(e) => {
              if (!ctl || !pressed.current || e.timeStamp - lastMove.current < MOVE_EVERY_MS) return;
              lastMove.current = e.timeStamp;
              push({ type: "mouse", action: "move", ...pointAt(e.clientX, e.clientY), button: pressed.current });
            }}
            onPointerUp={(e) => {
              if (!ctl || !pressed.current) return;
              push({ type: "mouse", action: "up", ...pointAt(e.clientX, e.clientY), button: pressed.current, clickCount: lastDown.current.count });
              pressed.current = null;
            }}
            onPointerCancel={(e) => {
              if (!pressed.current) return;
              push({ type: "mouse", action: "up", ...pointAt(e.clientX, e.clientY), button: pressed.current });
              pressed.current = null;
            }}
            onContextMenu={(e) => {
              if (ctl) e.preventDefault();
            }}
          >
            <img ref={imgRef} alt={t("live.screenAlt", { name })} draggable={false} className={hasFrame ? "" : "lb-hidden"} />
            {(!hasFrame || status !== "live") && (
              <div className="lb-overlay" role="status">
                {status === "ended" ? t("live.ended") : status === "reconnecting" ? t("live.reconnecting") : !hasFrame ? t("live.connecting") : null}
              </div>
            )}
            {ctl && (
              <textarea
                ref={keysRef}
                className="lb-keys"
                aria-label={t("live.keyboard", { name })}
                aria-describedby="lb-keys-note"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                rows={1}
                onKeyDown={(e) => {
                  if (composing.current || e.nativeEvent.isComposing || e.key === "Process" || e.key === "Dead") return;
                  if (e.key === "F6") {
                    e.preventDefault();
                    doneRef.current?.focus();
                    return;
                  }
                  // Ctrl/Cmd+V pastes through the paste event below.
                  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "v") return;
                  const combo = keyCombo(e);
                  if (!combo) return;
                  e.preventDefault();
                  e.stopPropagation();
                  push({ type: "key", key: combo });
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  const v = e.currentTarget.value;
                  e.currentTarget.value = "";
                  if (v) sendText(v);
                }}
                onInput={(e) => {
                  if (composing.current) return;
                  const v = e.currentTarget.value;
                  e.currentTarget.value = "";
                  if (v) sendText(v);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text/plain");
                  if (text) sendText(text);
                }}
              />
            )}
          </div>
        </div>

        <div className="lb-actions">
          {ctl ? (
            <button ref={doneRef} className="btn primary sm" onClick={() => void control("release")} disabled={busy}>
              <Icon name="check" size={15} /> {t("live.done")}
            </button>
          ) : (
            <button ref={takeRef} className="btn sm" onClick={() => void control("take")} disabled={busy || !live}>
              <Icon name="cursor" size={15} /> {t("live.take")}
            </button>
          )}
        </div>
        <p className="lb-note" id="lb-keys-note">
          {ctl ? t("live.keysNote") : t("live.watchNote", { name })}
        </p>
        {err && (
          <p className="notice error small" role="alert">
            {err}
          </p>
        )}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announce}
        </div>
      </div>
    </div>
  );
}
