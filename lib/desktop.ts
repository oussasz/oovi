// What the desktop app exposes to the page (electron/preload.cjs).
// Missing when the UI runs in a normal browser (e.g. `npm run web`).

/** installing: oovi is about to close, install the update and restart by itself. */
export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "installing" | "error";

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
  /** Installed from the Microsoft Store: the Store handles updates. */
  store?: boolean;
  canInstall: boolean;
  platform: string;
  /** Release notes of the new version. */
  notesUrl: string;
  checkedAt: number | null;
  /** Set (for this run only) when oovi just restarted into a new version. */
  updatedTo?: string | null;
  /** Release notes of the version just installed. */
  updatedNotesUrl?: string | null;
};

/** "Keep oovi running in the background (system tray)". supported: false on macOS (it already keeps running). */
export type BackgroundState = { supported: boolean; on: boolean };

export type DesktopBridge = {
  pickFolder: (current?: string) => Promise<string | null>;
  background?: {
    get: () => Promise<BackgroundState | null>;
    set: (on: boolean) => Promise<BackgroundState | null>;
  };
  /** The desktop app asks the page to open an in-app path (/c/<id> or /routines). */
  onNavigate?: (cb: (path: string) => void) => () => void;
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
