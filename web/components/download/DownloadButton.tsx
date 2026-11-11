"use client";

import type { ReactNode } from "react";
import { AppleIcon, ArrowRight, LinuxIcon, WindowsIcon } from "../icons";
import { useDownload } from "./DownloadProvider";
import type { Os } from "./DownloadChooser";

type Props = {
  os?: Os;
  variant?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
  showIcon?: boolean;
  className?: string;
};

export function DownloadButton({ os, variant = "dark", size = "md", children, showIcon = true, className }: Props) {
  const { open } = useDownload();
  const label = children ?? (os === "mac" ? "Download for Mac" : os === "windows" ? "Download for Windows" : os === "linux" ? "Download for Linux" : "Download");
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className ?? ""}`}
      onClick={() => open(os)}
    >
      {showIcon && os === "mac" && <AppleIcon />}
      {showIcon && os === "windows" && <WindowsIcon />}
      {showIcon && os === "linux" && <LinuxIcon />}
      <span>{label}</span>
      <ArrowRight />
    </button>
  );
}
