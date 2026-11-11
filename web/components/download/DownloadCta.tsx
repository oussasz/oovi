"use client";

// The main download call to action: ONE button for the visitor's own system, and the other systems
// as a quiet line under it. (Three equal buttons wrapped onto two lines and read as a broken layout.)
// Before the page knows the system (first paint, phones), the button says "Download for Windows":
// most visitors are on Windows, and the window it opens lets anyone pick another system.
import { useEffect, useState } from "react";
import { AppleIcon, ArrowRight, LinuxIcon, WindowsIcon } from "../icons";
import { detectOs, type Os } from "./DownloadChooser";
import { useDownload } from "./DownloadProvider";

const SYSTEMS: { os: Os; name: string; Icon: typeof AppleIcon }[] = [
  { os: "windows", name: "Windows", Icon: WindowsIcon },
  { os: "mac", name: "Mac", Icon: AppleIcon },
  { os: "linux", name: "Linux", Icon: LinuxIcon },
];

export function DownloadCta({ size = "lg" }: { size?: "md" | "lg" }) {
  const { open } = useDownload();
  const [os, setOs] = useState<Os>("windows");
  useEffect(() => {
    const d = detectOs();
    if (d) setOs(d);
  }, []);
  const mine = SYSTEMS.find((s) => s.os === os)!;
  return (
    <div className="dl-cta">
      <button type="button" className={`btn btn-dark btn-${size}`} onClick={() => open(os)}>
        <mine.Icon />
        <span>Download for {mine.name}</span>
        <ArrowRight />
      </button>
      <p className="dl-also">
        <span>Also for</span>
        {SYSTEMS.filter((s) => s.os !== os).map((s) => (
          <button key={s.os} type="button" className="dl-also-link" onClick={() => open(s.os)}>
            <s.Icon size={14} />
            {s.name}
          </button>
        ))}
      </p>
    </div>
  );
}
