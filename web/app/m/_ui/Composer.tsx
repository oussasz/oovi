"use client";

// The message box: grows with the text, Send, a voice note that turns into text in the box (to check before
// sending, like the computer app), and Stop while the bots work. It stays above the keyboard on iPhone
// (visualViewport) and above the home indicator (safe area).
import { useEffect, useRef, useState } from "react";
import { ApiError, transcribe } from "../_lib/api";
import { tap } from "../_lib/haptics";
import { Icon } from "./Icon";
import { Spinner } from "./kit";
import { useM } from "./MobileApp";

const MAX_SECONDS = 120;

function pickMime(): string {
  const MR = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) if (MR.isTypeSupported(t)) return t;
  return "";
}

export function Composer({
  placeholder,
  running,
  stopping,
  disabled,
  onSend,
  onStop,
  onToast,
}: {
  placeholder: string;
  running: boolean;
  stopping: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onToast: (msg: string) => void;
}) {
  const { t } = useM();
  const [text, setText] = useState("");
  const [rec, setRec] = useState<"idle" | "recording" | "working">("idle");
  const [secs, setSecs] = useState(0);
  const [canVoice, setCanVoice] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef(0);

  useEffect(() => {
    setCanVoice(typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  // Grow with the text (up to about 6 lines; then it scrolls inside).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  // Keep the bar above the iPhone keyboard: the space the keyboard covers goes into --m-kb.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--m-kb", `${Math.round(kb)}px`);
      document.documentElement.classList.toggle("m-kb-open", kb > 40);
      const h = wrap.current?.offsetHeight ?? 60;
      document.documentElement.style.setProperty("--m-composer", `${h}px`);
    };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      document.documentElement.style.removeProperty("--m-kb");
      document.documentElement.classList.remove("m-kb-open");
    };
  }, []);
  useEffect(() => {
    const h = wrap.current?.offsetHeight;
    if (h) document.documentElement.style.setProperty("--m-composer", `${h}px`);
  });

  useEffect(
    () => () => {
      cancelled.current = true;
      window.clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  const send = async () => {
    const v = text.trim();
    if (!v || disabled) return;
    setText("");
    const ok = await onSend(v);
    if (!ok) setText(v);
    box.current?.focus();
  };

  const startVoice = async () => {
    if (rec !== "idle") return;
    tap("medium");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onToast(t("chat.voice.denied"));
      return;
    }
    const mime = pickMime();
    let r: MediaRecorder;
    try {
      r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((tr) => tr.stop());
      onToast(t("chat.voice.unavailable"));
      return;
    }
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      window.clearInterval(timer.current);
      if (cancelled.current) {
        setRec("idle");
        return;
      }
      setRec("working");
      const blob = new Blob(chunks.current, { type: (r.mimeType || mime || "audio/mp4").split(";")[0] });
      try {
        const words = await transcribe(blob);
        if (words) setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${words}` : words));
        else onToast(t("chat.voice.failed"));
      } catch (err) {
        onToast(err instanceof ApiError && (err.status === 503 || err.status === 402 || err.status === 404) ? t("chat.voice.unavailable") : t("chat.voice.failed"));
      } finally {
        setRec("idle");
        box.current?.focus();
      }
    };
    recorder.current = r;
    r.start(1000);
    setSecs(0);
    setRec("recording");
    const began = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000);
      setSecs(s);
      if (s >= MAX_SECONDS) {
        onToast(t("chat.voice.tooLong"));
        r.stop();
      }
    }, 250);
  };

  const finishVoice = (keep: boolean) => {
    cancelled.current = !keep;
    tap(keep ? "success" : "light");
    recorder.current?.state === "recording" ? recorder.current.stop() : setRec("idle");
  };

  const showStop = running && !text.trim() && rec === "idle";
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="m-composer" ref={wrap}>
      {rec === "recording" ? (
        <div className="m-rec" role="status">
          <button type="button" className="m-icon-btn" onClick={() => finishVoice(false)} aria-label={t("common.cancel")}>
            <Icon name="close" size={22} stroke={2.2} />
          </button>
          <span className="m-rec__dot" aria-hidden />
          <span className="m-rec__label">
            {t("chat.recording")} <time>{mmss}</time>
          </span>
          <span className="m-rec__wave" aria-hidden>
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />
            ))}
          </span>
          <button type="button" className="m-send is-on" onClick={() => finishVoice(true)} aria-label={t("chat.stopRecording")}>
            <Icon name="up" size={20} stroke={2.6} />
          </button>
        </div>
      ) : (
        <div className="m-composer__row">
          <div className="m-composer__field">
            <textarea
              ref={box}
              rows={1}
              dir="auto"
              value={text}
              placeholder={rec === "working" ? t("chat.transcribing") : placeholder}
              aria-label={placeholder}
              disabled={rec === "working"}
              maxLength={20_000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // A hardware keyboard: Enter sends, Shift+Enter is a new line. The on-screen keyboard keeps Enter for new lines.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {rec === "working" && <Spinner size={18} />}
            {canVoice && rec === "idle" && !text.trim() && (
              <button type="button" className="m-icon-btn m-composer__mic" onClick={startVoice} aria-label={t("chat.voice")} disabled={disabled}>
                <Icon name="mic" size={22} />
              </button>
            )}
          </div>
          {showStop ? (
            <button type="button" className="m-send m-send--stop" onClick={onStop} disabled={stopping} aria-label={stopping ? t("chat.stopping") : t("chat.stop")}>
              {stopping ? <Spinner size={16} /> : <Icon name="stop" size={30} stroke={0} />}
            </button>
          ) : (
            <button type="button" className={`m-send${text.trim() && !disabled ? " is-on" : ""}`} onClick={send} disabled={!text.trim() || disabled} aria-label={t("chat.send")}>
              <Icon name="up" size={20} stroke={2.6} />
            </button>
          )}
        </div>
      )}
      {disabled && <p className="m-composer__hint">{t("chat.offlineSend")}</p>}
    </div>
  );
}
