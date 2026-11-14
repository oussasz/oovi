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
      "Each task asks you first, and you can stop it any time with the Stop banner (you can keep using your mouse meanwhile). oovi refuses password managers, banking windows, terminals and system settings, but these protections are best effort. Never use this for banking, payments or passwords.",
    ok: "Turn on",
    cancel: "Cancel",
  },
  fr: {
    title: "Laisser les bots contrôler cet ordinateur ?",
    message: "Les bots verront votre écran et utiliseront votre souris et votre clavier, comme s'ils utilisaient votre ordinateur à votre place.",
    detail:
      "Chaque tâche vous demande d'abord, et vous pouvez l'arrêter à tout moment avec le bandeau Arrêter (vous pouvez continuer à utiliser votre souris). oovi refuse les gestionnaires de mots de passe, les fenêtres bancaires, les terminaux et les paramètres système, mais ces protections ne sont pas infaillibles. Ne l'utilisez jamais pour la banque, les paiements ou les mots de passe.",
    ok: "Activer",
    cancel: "Annuler",
  },
  ar: {
    title: "هل تسمح للبوتات بالتحكم في هذا الحاسوب؟",
    message: "سترى البوتات شاشتك وتستخدم الفأرة ولوحة المفاتيح، كأنها تستخدم حاسوبك باسمك.",
    detail:
      "كل مهمة تطلب إذنك أولًا، ويمكنك إيقافها في أي وقت بشريط الإيقاف (ويمكنك مواصلة استعمال الفأرة). يرفض oovi مديري كلمات المرور والنوافذ المصرفية والطرفيات وإعدادات النظام، لكن هذه الحماية ليست مضمونة تمامًا. لا تستخدمه أبدًا للخدمات المصرفية أو المدفوعات أو كلمات المرور.",
    ok: "تفعيل",
    cancel: "إلغاء",
  },
  es: {
    title: "¿Dejar que los bots controlen este ordenador?",
    message: "Los bots verán tu pantalla y usarán tu ratón y teclado, como si usaran tu ordenador en tu lugar.",
    detail:
      "Cada tarea te pregunta primero, y puedes pararla cuando quieras con el aviso Detener (puedes seguir usando el ratón). oovi rechaza gestores de contraseñas, ventanas bancarias, terminales y la configuración del sistema, pero estas protecciones no son infalibles. Nunca lo uses para banca, pagos o contraseñas.",
    ok: "Activar",
    cancel: "Cancelar",
  },
  de: {
    title: "Bots diesen Computer steuern lassen?",
    message: "Bots sehen deinen Bildschirm und nutzen Maus und Tastatur, als würden sie deinen Computer als du benutzen.",
    detail:
      "Jede Aufgabe fragt dich zuerst, und du kannst sie jederzeit mit dem Stopp-Banner anhalten (die Maus kannst du weiter benutzen). oovi verweigert Passwortmanager, Banking-Fenster, Terminals und Systemeinstellungen, aber dieser Schutz ist nicht lückenlos. Nutze es nie für Banking, Zahlungen oder Passwörter.",
    ok: "Einschalten",
    cancel: "Abbrechen",
  },
  tr: {
    title: "Botların bu bilgisayarı kontrol etmesine izin verilsin mi?",
    message: "Botlar ekranını görecek ve fareni ve klavyeni kullanacak; bilgisayarını senin yerine kullanmak gibi.",
    detail:
      "Her görev önce sana sorar ve Durdur bandıyla istediğin an durdurabilirsin (fareni kullanmaya devam edebilirsin). oovi şifre yöneticilerini, bankacılık pencerelerini, terminalleri ve sistem ayarlarını reddeder, ama bu korumalar kusursuz değildir. Bankacılık, ödemeler veya şifreler için asla kullanma.",
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

function createDesktopControl({ app, BrowserWindow, screen, desktopCapturer, powerMonitor, dialog, nativeImage, shell }) {
  const fs = require("node:fs");
  const { execFile, spawn } = require("node:child_process");
  const path = require("node:path");
  // oovi's own windows, minimized while a bot controls the computer. They cover the screen the bot must
  // see (and are blacked out in its screenshots), so a bot started from a maximized oovi saw only black.
  let aside = [];
  function stepAside() {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === overlay || w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue;
      try {
        w.minimize();
        aside.push(w);
      } catch {
        /* that window stays where it is */
      }
    }
  }
  /** The task ended or needs the user's OK: oovi comes back where it was. */
  function comeBack() {
    const list = aside;
    aside = [];
    for (const w of list) {
      try {
        if (w.isDestroyed()) continue;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      } catch {
        /* closed meanwhile */
      }
    }
  }
  // ---- what the user sees while a bot controls the computer: glowing screen edges and a large pointer ----
  // Small click-through windows, never a full-screen one: oovi refuses to act on its own windows, so
  // nothing of oovi's may sit under the point the bot clicks. The edges are thin strips at the screen
  // border; the pointer window sits just beside the real pointer's tip. All are kept out of the bot's
  // screenshots (content protection) and are a bonus: if one can't be made, control goes on without it.
  const EDGE = 18; // DIP: a soft glow that fades toward the middle of the screen
  const POINTER = 56; // DIP
  let edges = [];
  let pointerWin = null;
  const decoPage = (body, css) =>
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}${css}</style></head><body>${body}</body></html>`)}`;
  function decoWindow(bounds, url) {
    const w = new BrowserWindow({
      ...bounds,
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
      title: "",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
    });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setIgnoreMouseEvents(true); // clicks and hit-testing pass through to what is underneath
    try {
      w.setContentProtection(true);
    } catch {
      /* older Windows: it shows in screenshots */
    }
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    w.once("ready-to-show", () => {
      try {
        if (w.isDestroyed()) return;
        w.showInactive();
        // On a second screen with another scale (125%, 150%…) Windows may place it by the first
        // screen's scale: set the same bounds again once it is on its screen.
        w.setBounds(bounds);
      } catch {
        /* a bonus */
      }
    });
    void w.loadURL(url).catch(() => {});
    return w;
  }
  // oovi's colors: lilac, periwinkle blue and coral, flowing slowly along the edges of every screen.
  const GLOW_CSS = (dir, along) => `
.g{position:absolute;inset:0;
  background:linear-gradient(${along},#b9a7ff,#8fb0ff,#ffb199,#c9a7ff,#8fb0ff,#b9a7ff);background-size:300% 300%;
  -webkit-mask-image:linear-gradient(${dir},#000 0%,rgba(0,0,0,.75) 40%,transparent 100%);mask-image:linear-gradient(${dir},#000 0%,rgba(0,0,0,.75) 40%,transparent 100%);
  animation:flow 6s linear infinite,breathe 2.8s ease-in-out infinite}
@keyframes flow{0%{background-position:0% 50%}100%{background-position:300% 50%}}
@keyframes breathe{0%,100%{opacity:.7}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){.g{animation:none;opacity:.85}}`;
  function showDeco() {
    hideDeco();
    try {
      for (const d of screen.getAllDisplays()) {
        const b = d.bounds;
        const glow = (dir, along) => decoPage('<div class="g"></div>', GLOW_CSS(dir, along));
        edges.push(
          decoWindow({ x: b.x, y: b.y, width: b.width, height: EDGE }, glow("to bottom", "90deg")),
          decoWindow({ x: b.x, y: b.y + b.height - EDGE, width: b.width, height: EDGE }, glow("to top", "270deg")),
          decoWindow({ x: b.x, y: b.y + EDGE, width: EDGE, height: b.height - 2 * EDGE }, glow("to right", "0deg")),
          decoWindow({ x: b.x + b.width - EDGE, y: b.y + EDGE, width: EDGE, height: b.height - 2 * EDGE }, glow("to left", "180deg")),
        );
      }
      const p = screen.getPrimaryDisplay().bounds;
      // The pointer: oovi's lilac, with a ring that pulses on a click.
      pointerWin = decoWindow(
        { x: p.x + Math.round(p.width / 2), y: p.y + Math.round(p.height / 2), width: POINTER, height: POINTER },
        decoPage(
          '<div class="r" id="r"></div><svg viewBox="0 0 32 32" width="40" height="40"><path d="M5 3.5 26.5 14.2c1 .5.9 2-.2 2.3l-8.300 2.300-3.600 8.200c-.500 1.100-2 1-2.400-.100z" fill="#b9a7ff" stroke="#171717" stroke-width="2" stroke-linejoin="round"/></svg>',
          "svg{position:absolute;left:0;top:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}.r{position:absolute;left:-14px;top:-14px;width:40px;height:40px;border-radius:50%;border:3px solid #ffb199;opacity:0;transform:scale(.3)}.r.on{animation:c .45s ease-out}@keyframes c{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.25)}}",
        ),
      );
    } catch {
      hideDeco();
    }
  }
  function hideDeco() {
    for (const w of [...edges, pointerWin]) {
      try {
        if (w && !w.isDestroyed()) w.destroy();
      } catch {
        /* already gone */
      }
    }
    edges = [];
    pointerWin = null;
  }
  /** Physical pixels of the primary display -> the DIP point Electron places windows with. */
  function toDip(x, y) {
    try {
      if (typeof screen.screenToDipPoint === "function") return screen.screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
    } catch {
      /* fall through */
    }
    const d = screen.getPrimaryDisplay();
    const k = d.scaleFactor || 1;
    return { x: Math.round(d.bounds.x + x / k), y: Math.round(d.bounds.y + y / k) };
  }

  /** Start-menu shortcuts (this user's and everyone's): the apps a bot may be allowed to open. */
  let appCache = { at: 0, list: [] };
  function startMenuApps() {
    if (Date.now() - appCache.at < 60_000) return appCache.list;
    const roots = [
      process.env.APPDATA && path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs"),
      process.env.ProgramData && path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"),
    ].filter(Boolean);
    const list = [];
    const walk = (dir, depth) => {
      if (depth > 4 || list.length >= 2000) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (/\.lnk$/i.test(e.name)) {
          let target;
          try {
            target = shell.readShortcutLink(full).target || "";
          } catch {
            target = undefined; // some shortcuts (installed by Windows Installer) don't say what they start
          }
          list.push({ name: e.name.replace(/\.lnk$/i, ""), path: full, target });
        }
      }
    };
    for (const r of roots) walk(r, 0);
    appCache = { at: Date.now(), list };
    return list;
  }
  /**
   * Microsoft Store apps (WhatsApp, Netflix, the new Outlook…): they have no Start-menu shortcut file.
   * Windows lists them with Get-StartApps; only packaged apps (ids with "!") are kept, the rest are the
   * shortcuts already found above. Read once in the background and cached for ten minutes.
   */
  let storeCache = { at: 0, list: [], loading: false };
  function storeApps() {
    if (process.platform !== "win32") return [];
    if (!storeCache.loading && Date.now() - storeCache.at > 600_000) {
      storeCache.loading = true;
      const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      execFile(ps, ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        storeCache.loading = false;
        storeCache.at = Date.now();
        if (err) return;
        try {
          const j = JSON.parse(String(out || "[]"));
          const rows = Array.isArray(j) ? j : [j];
          storeCache.list = rows.filter((r) => r && r.Name && r.AppID && /^[\w.\-]+!\w[\w.\-]*$/.test(r.AppID)).map((r) => ({ name: String(r.Name), path: `shell:AppsFolder\\${r.AppID}`, store: true }));
        } catch {
          /* keep the last list */
        }
      });
    }
    return storeCache.list;
  }
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
    const mine = [overlay, pointerWin, ...edges].filter((x) => x && !x.isDestroyed()).map(hwndOf);
    return mine.includes(w.handle) ? { ...w, overlay: true } : w;
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
    /**
     * Every screen: id, name, main or not, its top-left corner and size in real pixels (the
     * coordinates the mouse uses; the main screen starts at 0,0, others can be left of or above it).
     */
    screens() {
      const primary = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label || "",
        primary: d.id === primary,
        origin: d.nativeOrigin ? { x: d.nativeOrigin.x, y: d.nativeOrigin.y } : { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor) },
        size: { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) },
        scaleFactor: d.scaleFactor,
        internal: !!d.internal,
      }));
    },
    async capture({ real, out, fit = false, crop = null, mask = [], quality = 70, screen: which = null }) {
      const d = (which !== null && screen.getAllDisplays().find((x) => x.id === which)) || screen.getPrimaryDisplay();
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
    /** The windows the user can switch to, minimized ones included (oovi's own are marked own: true). */
    appWindows() {
      return windows().appWindows().map(tag);
    },
    /** switch | minimize | maximize | restore | close one of them (the server checked it may). "" or an error. */
    windowAction(handle, action) {
      if (!["switch", "minimize", "maximize", "restore", "close"].includes(action)) return "Unknown action.";
      return windows().act(handle, action);
    },
    move(x, y) {
      // Windows' own call works on every screen layout; the input library is the fallback.
      if (windows().setCursor && windows().setCursor(x, y)) return;
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
      // Unicode input on Windows: the same for every keyboard layout. libnut's typeString pressed keys as
      // if the keyboard were American, so French (AZERTY) and Arabic keyboards got garbled text.
      const w = windows();
      if (w && typeof w.typeText === "function") {
        const err = w.typeText(String(text));
        if (err) throw new Error(err);
        return;
      }
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
    /**
     * Shows the user where the bot's pointer is (x, y in physical pixels); click: pulse a ring there.
     * The window sits just right of and below the real pointer's tip, never on it.
     */
    pointer(x, y, click) {
      try {
        if (!pointerWin || pointerWin.isDestroyed()) return;
        const p = toDip(x, y);
        pointerWin.setBounds({ x: p.x + 2, y: p.y + 2, width: POINTER, height: POINTER });
        if (click) void pointerWin.webContents.executeJavaScript('(()=>{const r=document.getElementById("r");r.classList.remove("on");void r.offsetWidth;r.classList.add("on")})()').catch(() => {});
      } catch {
        /* a bonus: the real pointer still moves */
      }
    },
    /** Installed apps: Start-menu shortcuts, and Microsoft Store apps ({ name, path: "shell:AppsFolder\\<id>", store: true }). Windows only. */
    apps() {
      return process.platform === "win32" ? [...startMenuApps(), ...storeApps()] : [];
    },
    /** Start one of those apps (the server checked it and the user said yes). Resolves "" or an error text. */
    async openApp(file) {
      if (process.platform !== "win32") return "Desktop control is only available on Windows for now.";
      const store = storeApps().find((a) => a.path === file);
      if (store) {
        // A Store app has no file to open: Windows starts it from its app id, as the Start menu does.
        return await new Promise((resolve) => {
          const p = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [store.path], { detached: true, stdio: "ignore", windowsHide: false });
          p.once("error", (e) => resolve(String((e && e.message) || e)));
          p.once("spawn", () => {
            p.unref();
            resolve("");
          });
        });
      }
      const known = startMenuApps().some((a) => a.path === file);
      if (!known) return "That isn't an app from the Start menu.";
      return (await shell.openPath(file)) || "";
    },
    /**
     * Open a web address in the user's default browser, whichever it is (the system decides, as when the
     * user clicks a link). Only http(s). Resolves "" or an error text.
     */
    async openInBrowser(url) {
      if (!/^https?:\/\//i.test(String(url))) return "Only web addresses (http or https) can be opened.";
      try {
        await shell.openExternal(String(url));
        return "";
      } catch (e) {
        return String((e && e.message) || e);
      }
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
      // A bot is starting to use the computer: read the Store apps now (a few seconds), so open_app finds them.
      storeApps();
      if (overlay && !overlay.isDestroyed()) {
        stepAside();
        if (!pointerWin || pointerWin.isDestroyed()) showDeco();
        return Promise.resolve(overlay.isVisible());
      }
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
            if (!win.isVisible()) return finish(false);
            // oovi's own window gets out of the way; a moment for it to finish minimizing before the first screenshot.
            stepAside();
            showDeco();
            setTimeout(() => finish(true), 400);
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
      hideDeco();
      comeBack();
    },
  };

  return { bridge, init };
}

module.exports = { createDesktopControl };
