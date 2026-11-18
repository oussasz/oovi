"use client";

// The microphone beside the message box: press to record, press again to stop. What was said comes back as
// text in the box (lib/voice.ts), to check and send. Nothing is recorded until it is pressed, and recording
// stops by itself after 2 minutes.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./I18n";

const MAX_MS = 120_000;

export default function MicButton({ onText, onError, disabled }: { onText: (text: string) => void; onError: (msg: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    if (stopAt.current) clearTimeout(stopAt.current);
    timer.current = null;
    stopAt.current = null;
    rec.current?.stream.getTracks().forEach((tr) => tr.stop());
  };
  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return onError(t("mic.unsupported"));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError(t("mic.denied"));
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((x) => MediaRecorder.isTypeSupported(x)) ?? "";
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => void send(r.mimeType || type || "audio/webm");
    rec.current = r;
    r.start(1000);
    setSecs(0);
    setState("recording");
    timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    stopAt.current = setTimeout(stop, MAX_MS);
  }

  function stop() {
    const r = rec.current;
    if (r && r.state !== "inactive") r.stop();
    cleanup();
  }

  async function send(mime: string) {
    const blob = new Blob(chunks.current, { type: mime });
    chunks.current = [];
    if (blob.size < 1200) {
      setState("idle");
      return onError(t("mic.tooShort"));
    }
    setState("working");
    try {
      const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": mime.split(";")[0]! }, body: blob });
      const j = (await r.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!r.ok || !j?.text) onError(j?.error || t("mic.failed"));
      else onText(j.text);
    } catch {
      onError(t("mic.failed"));
    } finally {
      setState("idle");
    }
  }

  const label = state === "recording" ? t("mic.stop", { secs }) : state === "working" ? t("mic.working") : t("mic.start");
  return (
    <button
      type="button"
      className={`mic-btn${state === "recording" ? " on" : ""}`}
      onClick={() => (state === "recording" ? stop() : state === "idle" ? void start() : undefined)}
      disabled={disabled || state === "working"}
      title={label}
      aria-label={label}
      aria-pressed={state === "recording"}
    >
      {state === "recording" ? (
        <span className="mic-time">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}</span>
      ) : state === "working" ? (
        <span className="mic-spin" aria-hidden="true" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
