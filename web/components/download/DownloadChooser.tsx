"use client";

import { useEffect, useState } from "react";
import { AppleIcon, ArrowRight, WindowsIcon } from "../icons";
import { MacInstallGuide } from "./MacInstallGuide";

export type Os = "mac" | "windows";

/** Set on Vercel once oovi is live in the Microsoft Store (see lib/releases.ts microsoftStoreUrl). */
const STORE_URL = process.env.NEXT_PUBLIC_MICROSOFT_STORE_URL ?? "";
type MacArch = "arm64" | "intel";

type NavigatorUAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

export function detectOs(): Os | null {
  if (typeof navigator === "undefined") return null;
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  const platform = (uaData?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (platform.includes("mac") || ua.includes("mac os")) return "mac";
  if (platform.includes("win") || ua.includes("windows")) return "windows";
  return null;
}

async function detectMacArch(): Promise<MacArch | null> {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  try {
    const v = await uaData?.getHighEntropyValues?.(["architecture"]);
    if (v?.architecture === "arm") return "arm64";
    if (v?.architecture === "x86") return "intel";
  } catch {
    /* ignore */
  }
  return null;
}

export function DownloadChooser({ initialOs, compact = false }: { initialOs?: Os | null; compact?: boolean }) {
  const [os, setOs] = useState<Os>(initialOs ?? "mac");
  const [arch, setArch] = useState<MacArch>("arm64");
  const [archDetected, setArchDetected] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!initialOs) {
      const d = detectOs();
      if (d) setOs(d);
    }
    if (detectOs() !== "mac") return;
    detectMacArch().then((a) => {
      if (a) {
        setArch(a);
        setArchDetected(true);
      }
    });
  }, [initialOs]);

  const target = os === "windows" ? "windows" : arch === "arm64" ? "mac-arm64" : "mac-intel";
  const store = os === "windows" && STORE_URL !== "";

  return (
    <div className={`chooser ${compact ? "chooser-compact" : ""}`}>
      <div className="seg" role="tablist" aria-label="Choose your computer">
        <button
          type="button"
          role="tab"
          aria-selected={os === "mac"}
          className={os === "mac" ? "on" : ""}
          onClick={() => {
            setOs("mac");
            setStarted(false);
          }}
        >
          <AppleIcon size={16} /> Mac
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={os === "windows"}
          className={os === "windows" ? "on" : ""}
          onClick={() => {
            setOs("windows");
            setStarted(false);
          }}
        >
          <WindowsIcon size={14} /> Windows
        </button>
      </div>

      {os === "mac" && (
        <fieldset className="arch">
          <legend>Which Mac do you have?</legend>
          <label className={arch === "arm64" ? "on" : ""}>
            <input type="radio" name="arch" checked={arch === "arm64"} onChange={() => setArch("arm64")} />
            <span>
              <b>Apple silicon</b>
              <small>M1, M2, M3, M4 and newer</small>
            </span>
          </label>
          <label className={arch === "intel" ? "on" : ""}>
            <input type="radio" name="arch" checked={arch === "intel"} onChange={() => setArch("intel")} />
            <span>
              <b>Intel</b>
              <small>Older Macs (before late 2020)</small>
            </span>
          </label>
          {!archDetected && (
            <p className="hint">Not sure? Apple menu → About This Mac → look for “Chip: Apple M…”.</p>
          )}
        </fieldset>
      )}

      {store ? (
        <div className="notice">
          <p className="notice-title">
            <span className="notice-dot" /> Get oovi from the Microsoft Store
          </p>
          <p>No security warnings: Microsoft checks oovi, and the Store keeps it up to date by itself.</p>
        </div>
      ) : os === "mac" ? (
        <MacInstallGuide />
      ) : (
      <div className="notice">
        <p className="notice-title">
          <span className="notice-dot" /> Heads up: oovi isn’t code-signed yet
        </p>
        <p>
          When you run the installer, Windows may show <q>Windows protected your PC</q> (Microsoft Defender
          SmartScreen). That’s expected during the pilot. Here’s how to continue:
        </p>
        <ol className="steps">
          <li>Run <b>oovi-Setup.exe</b> from your Downloads.</li>
          <li>On the blue “Windows protected your PC” screen, click <b>More info</b>.</li>
          <li>Click <b>Run anyway</b> and follow the installer.</li>
        </ol>
      </div>
      )}

      <a
        className="btn btn-dark btn-lg chooser-cta"
        href={`/download/${target}`}
        onClick={() => setStarted(true)}
      >
        {os === "mac" ? <AppleIcon /> : <WindowsIcon />}
        {store ? "Get it from Microsoft Store" : `Download for ${os === "mac" ? (arch === "arm64" ? "Mac (Apple silicon)" : "Mac (Intel)") : "Windows"}`}
        <ArrowRight />
      </a>
      <p className="fine" aria-live="polite">
        {started
          ? store
            ? "Opening the Microsoft Store…"
            : "Your download should start in a moment. Then follow the steps above."
          : "Free during the pilot · Bring your own AI key"}
      </p>
      {store && (
        <p className="fine">
          Prefer the installer? <a href="/download/windows?installer=1">Download oovi-Setup.exe</a>. Windows may show
          “Windows protected your PC”: click <b>More info</b>, then <b>Run anyway</b>.
        </p>
      )}
    </div>
  );
}
