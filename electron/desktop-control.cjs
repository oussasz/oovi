// Desktop control (Beta), the Electron side: screenshots of the primary display, the mouse
// and keyboard (through @nut-tree-fork/libnut-win32, an N-API module), the active window,
// and the "oovi is controlling your computer — Stop" banner.
//
// The app's server (same process) reaches this through globalThis.__ooviDesktop.desktop;
// it decides what is allowed (lib/desktop-control.ts). Nothing here acts on its own.
// The native module is only loaded here, so Next.js never bundles or traces it.
// Windows only for now: unsigned macOS builds lose Screen Recording and Accessibility
// permissions on every update.

const OVERLAY_TEXT = {
  en: { busy: "oovi is controlling your computer", stop: "Stop" },
  fr: { busy: "oovi contrôle votre ordinateur", stop: "Arrêter" },
  ar: { busy: "يتحكم oovi في حاسوبك", stop: "إيقاف" },
  es: { busy: "oovi está controlando tu ordenador", stop: "Detener" },
  de: { busy: "oovi steuert deinen Computer", stop: "Stopp" },
  tr: { busy: "oovi bilgisayarını kontrol ediyor", stop: "Durdur" },
};

/** HWND from Electron's native handle buffer, as the number the input library uses. */
function hwndOf(win) {
  try {
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  } catch {
    return -1;
  }
}

function createDesktopControl({ app, BrowserWindow, screen, desktopCapturer, powerMonitor }) {
  let nut = null;
  let loadError = null;
  let locked = false;
  let overlay = null;
  let stopHandler = null;
  const lockListeners = new Set();

  function native() {
    if (nut || loadError) return nut;
    if (process.platform !== "win32") {
      loadError = "Desktop control is only available on Windows for now.";
      return null;
    }
    try {
      nut = require("@nut-tree-fork/libnut-win32");
    } catch (e) {
      loadError = `The mouse and keyboard module couldn't load: ${(e && e.message) || e}`;
      nut = null;
    }
    return nut;
  }
  const need = () => {
    const n = native();
    if (!n) throw new Error(loadError || "Desktop control isn't available.");
    return n;
  };

  /** Called once the app is ready (powerMonitor needs it). */
  function init() {
    try {
      powerMonitor.on("lock-screen", () => {
        locked = true;
        for (const f of lockListeners) {
          try {
            f();
          } catch {
            /* a listener must not break the others */
          }
        }
      });
      powerMonitor.on("unlock-screen", () => {
        locked = false;
      });
    } catch {
      /* no lock events on this system: actions still fail when the screen can't be captured */
    }
  }

  const ownWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());

  const bridge = {
    /** { ok } or { ok: false, reason } — reason is shown to the user. */
    available() {
      const n = native();
      return n ? { ok: true } : { ok: false, reason: loadError || "Desktop control isn't available." };
    },
    /** The primary display: size in DIPs, Windows scale factor, and the size the input library sees (physical pixels). */
    display() {
      const d = screen.getPrimaryDisplay();
      let nativeSize = null;
      try {
        nativeSize = native()?.getScreenSize() ?? null;
      } catch {
        nativeSize = null;
      }
      return { dip: { width: d.size.width, height: d.size.height }, scaleFactor: d.scaleFactor, native: nativeSize };
    },
    /**
     * A JPEG of the primary display. out: exact output size (screenshots) or the box to fit (zoom).
     * crop: part of the screen as fractions 0-1 (zoom). Throws "unavailable" when the screen can't be
     * captured (locked, a UAC prompt or another secure screen shows black).
     */
    async capture({ real, out, fit = false, crop = null, quality = 70 }) {
      const d = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: real.width, height: real.height } });
      const src = sources.find((s) => s.display_id === String(d.id)) ?? (sources.length === 1 ? sources[0] : null);
      if (!src || src.thumbnail.isEmpty()) throw new Error("unavailable");
      let img = src.thumbnail;
      const full = img.getSize();
      if (crop) {
        const rect = {
          x: Math.max(0, Math.round(crop.x * full.width)),
          y: Math.max(0, Math.round(crop.y * full.height)),
          width: Math.max(1, Math.round(crop.width * full.width)),
          height: Math.max(1, Math.round(crop.height * full.height)),
        };
        rect.width = Math.min(rect.width, full.width - rect.x);
        rect.height = Math.min(rect.height, full.height - rect.y);
        img = img.crop(rect);
      }
      const cur = img.getSize();
      let size = out;
      if (fit) {
        const k = Math.min(out.width / cur.width, out.height / cur.height);
        size = { width: Math.max(1, Math.round(cur.width * k)), height: Math.max(1, Math.round(cur.height * k)) };
      }
      const small = size.width === cur.width && size.height === cur.height ? img : img.resize({ width: size.width, height: size.height, quality: "good" });
      // A secure screen (lock screen, UAC) captures as solid black.
      const bmp = small.toBitmap();
      let lit = 0;
      for (let i = 0; i < bmp.length; i += 4 * 97) if (bmp[i] > 8 || bmp[i + 1] > 8 || bmp[i + 2] > 8) lit++;
      if (!crop && lit === 0) throw new Error("unavailable");
      const s = small.getSize();
      return { jpeg: small.toJPEG(quality), width: s.width, height: s.height };
    },
    /** Pointer position in physical pixels. */
    cursor() {
      return need().getMousePos();
    },
    /** The window that has the keyboard: its title, and whether it's one of oovi's own windows. */
    activeWindow() {
      const n = need();
      const h = n.getActiveWindow();
      let title = "";
      try {
        title = n.getWindowTitle(h) || "";
      } catch {
        title = "";
      }
      return { title, own: ownWindows().some((w) => hwndOf(w) === h) };
    },
    /** Is this physical-pixel point on one of oovi's own visible windows? */
    ownWindowAt(x, y) {
      for (const w of ownWindows()) {
        if (!w.isVisible() || w.isMinimized()) continue;
        let r = w.getBounds();
        try {
          if (screen.dipToScreenRect) r = screen.dipToScreenRect(w, r);
        } catch {
          /* fall back to DIPs */
        }
        if (x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) return true;
      }
      return false;
    },
    move(x, y) {
      need().moveMouse(Math.round(x), Math.round(y));
    },
    click(button, double) {
      need().mouseClick(button, !!double);
    },
    toggle(down, button) {
      need().mouseToggle(down ? "down" : "up", button);
    },
    scroll(x, y) {
      need().scrollMouse(Math.round(x), Math.round(y));
    },
    keyTap(key, modifiers) {
      need().keyTap(key, modifiers && modifiers.length ? modifiers : []);
    },
    keyToggle(key, down, modifiers) {
      need().keyToggle(key, down ? "down" : "up", modifiers && modifiers.length ? modifiers : []);
    },
    type(text) {
      need().typeString(String(text));
    },
    locked() {
      return locked;
    },
    /** Called when the screen locks. Returns an unsubscribe function. */
    onLock(fn) {
      lockListeners.add(fn);
      return () => lockListeners.delete(fn);
    },
    /** The Stop button on the banner calls this (the server aborts the run). */
    setStopHandler(fn) {
      stopHandler = typeof fn === "function" ? fn : null;
    },
    /** Shows the always-on-top banner. lang: the app's language ("auto" = the system's). */
    showOverlay(lang) {
      if (!app.isReady()) return;
      if (overlay && !overlay.isDestroyed()) return;
      const code = String(lang && lang !== "auto" ? lang : app.getLocale() || "en").slice(0, 2).toLowerCase();
      const text = OVERLAY_TEXT[code] || OVERLAY_TEXT.en;
      const rtl = code === "ar";
      const d = screen.getPrimaryDisplay();
      const W = 440;
      const H = 48;
      overlay = new BrowserWindow({
        width: W,
        height: H,
        x: d.workArea.x + Math.round((d.workArea.width - W) / 2),
        y: d.workArea.y + 10,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        hasShadow: false,
        show: false,
        title: "oovi",
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
      });
      overlay.setAlwaysOnTop(true, "screen-saver");
      // Keep the banner out of the bot's screenshots, so it never tries to click it.
      try {
        overlay.setContentProtection(true);
      } catch {
        /* older Windows: the banner shows in screenshots */
      }
      overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      overlay.webContents.on("will-navigate", (e) => e.preventDefault());
      // The Stop button sets the page title (works without a preload or any Node access in the page).
      overlay.on("page-title-updated", (e, title) => {
        e.preventDefault();
        if (title !== "oovi:stop") return;
        try {
          stopHandler?.();
        } catch {
          /* the banner still closes */
        }
        bridge.hideOverlay();
      });
      overlay.on("closed", () => {
        overlay = null;
      });
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>oovi</title><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none}
.b{box-sizing:border-box;height:44px;margin:2px;display:flex;align-items:center;gap:12px;padding:0 6px 0 16px;border-radius:22px;background:#171717;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35)}
[dir=rtl] .b{padding:0 16px 0 6px}
.d{width:10px;height:10px;border-radius:50%;background:#ef4444;flex:none;animation:p 1.4s ease-in-out infinite}
.t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{font:inherit;border:0;border-radius:16px;padding:7px 16px;background:#ef4444;color:#fff;cursor:pointer}
button:hover{background:#dc2626}
@keyframes p{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.d{animation:none}}
</style></head><body><div class="b" role="status"><span class="d"></span><span class="t">${esc(text.busy)}</span><button onclick="document.title='oovi:stop'">${esc(text.stop)}</button></div></body></html>`;
      overlay.once("ready-to-show", () => overlay?.showInactive());
      void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    },
    hideOverlay() {
      if (overlay && !overlay.isDestroyed()) overlay.destroy();
      overlay = null;
    },
  };

  return { bridge, init };
}

module.exports = { createDesktopControl };
