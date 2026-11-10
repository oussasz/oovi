// Desktop control (Beta), the Electron side: screenshots of the primary display (with private
// windows blacked out), the mouse and keyboard (through @nut-tree-fork/libnut-win32, an N-API
// module), facts about windows (through koffi and user32: electron/win32-windows.cjs), the
// "oovi is controlling your computer — Stop" banner, and the native consent dialog.
//
// The app's server (same process) reaches this through globalThis.__ooviDesktop.desktop;
// it decides what is allowed (lib/desktop-control.ts). Nothing here acts on its own.
// The native modules are only loaded here, so Next.js never bundles or traces them.
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

const CONSENT_TEXT = {
  en: {
    title: "Let bots control this computer?",
    message: "Bots will see your screen and use your mouse and keyboard, like using your computer as you.",
    detail:
      "Each task asks you first, and you can stop it any time with the Stop banner or by moving the mouse. oovi refuses password managers, banking windows, terminals and system settings, but these protections are best effort. Never use this for banking, payments or passwords.",
    ok: "Turn on",
    cancel: "Cancel",
  },
  fr: {
    title: "Laisser les bots contrôler cet ordinateur ?",
    message: "Les bots verront votre écran et utiliseront votre souris et votre clavier, comme s'ils utilisaient votre ordinateur à votre place.",
    detail:
      "Chaque tâche vous demande d'abord, et vous pouvez l'arrêter à tout moment avec le bandeau Arrêter ou en bougeant la souris. oovi refuse les gestionnaires de mots de passe, les fenêtres bancaires, les terminaux et les paramètres système, mais ces protections ne sont pas infaillibles. Ne l'utilisez jamais pour la banque, les paiements ou les mots de passe.",
    ok: "Activer",
    cancel: "Annuler",
  },
  ar: {
    title: "هل تسمح للبوتات بالتحكم في هذا الحاسوب؟",
    message: "سترى البوتات شاشتك وتستخدم الفأرة ولوحة المفاتيح، كأنها تستخدم حاسوبك باسمك.",
    detail:
      "كل مهمة تطلب إذنك أولًا، ويمكنك إيقافها في أي وقت بشريط الإيقاف أو بتحريك الفأرة. يرفض oovi مديري كلمات المرور والنوافذ المصرفية والطرفيات وإعدادات النظام، لكن هذه الحماية ليست مضمونة تمامًا. لا تستخدمه أبدًا للخدمات المصرفية أو المدفوعات أو كلمات المرور.",
    ok: "تفعيل",
    cancel: "إلغاء",
  },
  es: {
    title: "¿Dejar que los bots controlen este ordenador?",
    message: "Los bots verán tu pantalla y usarán tu ratón y teclado, como si usaran tu ordenador en tu lugar.",
    detail:
      "Cada tarea te pregunta primero, y puedes pararla cuando quieras con el aviso Detener o moviendo el ratón. oovi rechaza gestores de contraseñas, ventanas bancarias, terminales y la configuración del sistema, pero estas protecciones no son infalibles. Nunca lo uses para banca, pagos o contraseñas.",
    ok: "Activar",
    cancel: "Cancelar",
  },
  de: {
    title: "Bots diesen Computer steuern lassen?",
    message: "Bots sehen deinen Bildschirm und nutzen Maus und Tastatur, als würden sie deinen Computer als du benutzen.",
    detail:
      "Jede Aufgabe fragt dich zuerst, und du kannst sie jederzeit mit dem Stopp-Banner oder durch Bewegen der Maus anhalten. oovi verweigert Passwortmanager, Banking-Fenster, Terminals und Systemeinstellungen, aber dieser Schutz ist nicht lückenlos. Nutze es nie für Banking, Zahlungen oder Passwörter.",
    ok: "Einschalten",
    cancel: "Abbrechen",
  },
  tr: {
    title: "Botların bu bilgisayarı kontrol etmesine izin verilsin mi?",
    message: "Botlar ekranını görecek ve fareni ve klavyeni kullanacak; bilgisayarını senin yerine kullanmak gibi.",
    detail:
      "Her görev önce sana sorar ve Durdur bandıyla ya da fareyi oynatarak istediğin an durdurabilirsin. oovi şifre yöneticilerini, bankacılık pencerelerini, terminalleri ve sistem ayarlarını reddeder, ama bu korumalar kusursuz değildir. Bankacılık, ödemeler veya şifreler için asla kullanma.",
    ok: "Aç",
    cancel: "İptal",
  },
};

/** HWND from Electron's native handle buffer, as a number. */
function hwndOf(win) {
  try {
    const b = win.getNativeWindowHandle();
    return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
  } catch {
    return -1;
  }
}

const langOf = (app, lang) => String(lang && lang !== "auto" ? lang : app.getLocale() || "en").slice(0, 2).toLowerCase();

function createDesktopControl({ app, BrowserWindow, screen, desktopCapturer, powerMonitor, dialog, nativeImage }) {
  let nut = null;
  let win32 = null;
  let loadError = null;
  let locked = false;
  let overlay = null;
  let stopHandler = null;
  const lockListeners = new Set();

  function native() {
    if ((nut && win32) || loadError) return nut && win32 ? nut : null;
    if (process.platform !== "win32") {
      loadError = "Desktop control is only available on Windows for now.";
      return null;
    }
    try {
      nut = require("@nut-tree-fork/libnut-win32");
      win32 = require("./win32-windows.cjs").load(require("koffi"));
    } catch (e) {
      loadError = `The mouse and keyboard modules couldn't load: ${(e && e.message) || e}`;
      nut = null;
      win32 = null;
    }
    return nut && win32 ? nut : null;
  }
  const need = () => {
    const n = native();
    if (!n) throw new Error(loadError || "Desktop control isn't available.");
    return n;
  };
  const windows = () => {
    need();
    return win32;
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

  /** Marks the banner, so it's never treated as a window to hide or to avoid. */
  const tag = (w) => {
    if (!w) return null;
    const ov = overlay && !overlay.isDestroyed() ? hwndOf(overlay) : -2;
    return w.handle === ov ? { ...w, overlay: true } : w;
  };

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
     * mask: rectangles (real pixels) painted black before anything else. crop: part of the screen as
     * fractions 0-1 (zoom). Throws "unavailable" when the screen can't be captured (locked, a UAC
     * prompt or another secure screen shows black).
     */
    async capture({ real, out, fit = false, crop = null, mask = [], quality = 70 }) {
      const d = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: real.width, height: real.height } });
      const src = sources.find((s) => s.display_id === String(d.id)) ?? (sources.length === 1 ? sources[0] : null);
      if (!src || src.thumbnail.isEmpty()) throw new Error("unavailable");
      let img = src.thumbnail;
      const full = img.getSize();
      if (mask.length) {
        const kx = full.width / real.width;
        const ky = full.height / real.height;
        const bmp = Buffer.from(img.toBitmap());
        for (const r of mask) {
          const x0 = Math.max(0, Math.floor(r.x * kx));
          const y0 = Math.max(0, Math.floor(r.y * ky));
          const x1 = Math.min(full.width, Math.ceil((r.x + r.width) * kx));
          const y1 = Math.min(full.height, Math.ceil((r.y + r.height) * ky));
          for (let y = y0; y < y1; y++) {
            const row = y * full.width * 4;
            bmp.fill(0, row + x0 * 4, row + x1 * 4);
            for (let x = x0; x < x1; x++) bmp[row + x * 4 + 3] = 255;
          }
        }
        img = nativeImage.createFromBitmap(bmp, { width: full.width, height: full.height });
      }
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
      if (!crop && !mask.length) {
        const bmp = small.toBitmap();
        let lit = 0;
        for (let i = 0; i < bmp.length; i += 4 * 97) if (bmp[i] > 8 || bmp[i + 1] > 8 || bmp[i + 2] > 8) lit++;
        if (lit === 0) throw new Error("unavailable");
      }
      const s = small.getSize();
      return { jpeg: small.toJPEG(quality), width: s.width, height: s.height };
    },
    /** Pointer position in physical pixels. */
    cursor() {
      return need().getMousePos();
    },
    /** The window that has the keyboard: { handle, title, className, exe, own, elevated, rect }. */
    foreground() {
      return tag(windows().foreground());
    },
    /** The top-level window a click at this physical-pixel point lands on. */
    windowAt(x, y) {
      return tag(windows().windowAt(x, y));
    },
    /** Visible windows, top of the z-order first (the banner is marked overlay: true). */
    visibleWindows() {
      return windows().visibleWindows().map(tag);
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
    /** The native "turn on desktop control?" dialog over oovi's window. Resolves true only on "Turn on". */
    async confirmConsent(lang) {
      if (!app.isReady()) return false;
      const t = CONSENT_TEXT[langOf(app, lang)] || CONSENT_TEXT.en;
      const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible() && w !== overlay) || null;
      const opts = { type: "warning", title: "oovi", message: t.title, detail: `${t.message}\n\n${t.detail}`, buttons: [t.cancel, t.ok], defaultId: 0, cancelId: 0, noLink: true };
      const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
      return r.response === 1;
    },
    /**
     * Shows the always-on-top banner. lang: the app's language ("auto" = the system's).
     * Resolves true once it's on screen, false if it couldn't be shown (in 5 seconds).
     */
    showOverlay(lang) {
      if (!app.isReady()) return Promise.resolve(false);
      if (overlay && !overlay.isDestroyed()) return Promise.resolve(overlay.isVisible());
      const code = langOf(app, lang);
      const text = OVERLAY_TEXT[code] || OVERLAY_TEXT.en;
      const rtl = code === "ar";
      const d = screen.getPrimaryDisplay();
      const W = 440;
      const H = 48;
      let win;
      try {
        win = new BrowserWindow({
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
      } catch {
        return Promise.resolve(false);
      }
      overlay = win;
      win.setAlwaysOnTop(true, "screen-saver");
      // Keep the banner out of the bot's screenshots, so it never tries to click it.
      try {
        win.setContentProtection(true);
      } catch {
        /* older Windows: the banner shows in screenshots */
      }
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      // The Stop button sets the page title (works without a preload or any Node access in the page).
      win.on("page-title-updated", (e, title) => {
        e.preventDefault();
        if (title !== "oovi:stop") return;
        try {
          stopHandler?.();
        } catch {
          /* the banner still closes */
        }
        bridge.hideOverlay();
      });
      win.on("closed", () => {
        if (overlay === win) overlay = null;
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
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (!ok && overlay === win && !win.isDestroyed()) win.destroy();
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 5000);
        win.once("ready-to-show", () => {
          try {
            win.showInactive();
            finish(win.isVisible());
          } catch {
            finish(false);
          }
        });
        win.webContents.once("did-fail-load", () => finish(false));
        win.once("closed", () => finish(false));
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => finish(false));
      });
    },
    hideOverlay() {
      if (overlay && !overlay.isDestroyed()) overlay.destroy();
      overlay = null;
    },
  };

  return { bridge, init };
}

module.exports = { createDesktopControl };
