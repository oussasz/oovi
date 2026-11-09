"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { kind: "ok" | "error"; text: string } | null;

/** "Send a new link" for the signed-in person's own email address. */
export function ResendVerification({
  label = "Resend email",
  className = "btn btn-light btn-sm",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/auth/send-verification", { method: "POST", credentials: "same-origin" });
      if (res.status === 204) {
        setResult({ kind: "ok", text: "Sent. Check your inbox (and the spam folder). The link works for 24 hours." });
      } else if (res.ok) {
        setResult({ kind: "ok", text: "Your email is already confirmed." });
        router.refresh();
      } else if (res.status === 401) {
        setResult({ kind: "error", text: "Please log in again, then try once more." });
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setResult({ kind: "error", text: data.error || "Couldn't send the email. Please try again." });
      }
    } catch {
      setResult({ kind: "error", text: "Couldn't reach oovi. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resend">
      <button type="button" className={className} onClick={send} disabled={busy || result?.kind === "ok"}>
        {busy ? "Sending…" : result?.kind === "ok" ? "Sent" : label}
      </button>
      <p className={`resend-msg${result?.kind === "error" ? " is-error" : ""}`} role="status" aria-live="polite">
        {result?.text}
      </p>
    </div>
  );
}
