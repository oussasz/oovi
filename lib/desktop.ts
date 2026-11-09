// What the desktop app exposes to the page (electron/preload.cjs).
// Missing when the UI runs in a normal browser (e.g. `npm run web`).

export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";

export type UpdateState = {
  status: UpdateStatus;
  /** Version running now. */
  current: string;
  /** Newer version, when there is one. */
  version: string | null;
  /** Download progress, 0-100. */
  progress: number;
  /** offline | damaged | failed */
  error: string | null;
  /** Download in the background and install when oovi closes. */
  auto: boolean;
  /** oovi installs the update itself (Windows). Otherwise "Download" opens the website. */
  canInstall: boolean;
  platform: string;
  notesUrl: string;
  checkedAt: number | null;
};

export type DesktopBridge = {
  pickFolder: (current?: string) => Promise<string | null>;
  /** Resolves to "" when the file opened, or an error message. */
  openFile?: (path: string) => Promise<string>;
  showFile?: (path: string) => Promise<boolean>;
  updates?: {
    get: () => Promise<UpdateState | null>;
    check: () => Promise<UpdateState | null>;
    start: () => Promise<UpdateState | null>;
    setAuto: (on: boolean) => Promise<UpdateState | null>;
    onChange: (cb: (s: UpdateState) => void) => () => void;
  };
};

declare global {
  interface Window {
    oovi?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window === "undefined" ? undefined : window.oovi);
