"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon } from "../icons";
import { DownloadChooser, type Os } from "./DownloadChooser";

type Ctx = { open: (os?: Os) => void };
const DownloadContext = createContext<Ctx>({ open: () => {} });

export function useDownload() {
  return useContext(DownloadContext);
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; os: Os | null; key: number }>({ open: false, os: null, key: 0 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const open = useCallback((os?: Os) => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setState((s) => ({ open: true, os: os ?? null, key: s.key + 1 }));
  }, []);
  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    lastFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [state.open, close]);

  return (
    <DownloadContext.Provider value={{ open }}>
      {children}
      {state.open && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dl-title">
            <button ref={closeRef} type="button" className="modal-close" onClick={close} aria-label="Close">
              <CloseIcon />
            </button>
            <h2 id="dl-title">Download oovi</h2>
            <p className="modal-sub">Pick your computer. It takes about a minute to set up.</p>
            <DownloadChooser key={state.key} initialOs={state.os} compact />
          </div>
        </div>
      )}
    </DownloadContext.Provider>
  );
}
