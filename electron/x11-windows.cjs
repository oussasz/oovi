// X11 window facts and typing for desktop control on Linux, through koffi (FFI to libX11 and libXtst):
// the same answers electron/win32-windows.cjs gives on Windows. Which window is under a point (what a
// click really hits), the window that has the keyboard, the windows in stacking order (to black out
// private ones in screenshots), and for each: its title, class, program and whether it runs as another
// user (root). Window manager facts come from the EWMH properties every common desktop sets (GNOME,
// KDE, Xfce, Cinnamon, MATE…). Typing sends each character as itself (the way xdotool does), so Arabic,
// accents and any keyboard layout work, and the clipboard is never touched.
// X11 only: a Wayland session doesn't let programs see or move other windows (desktop-control.cjs says so).
// Coordinates are physical pixels of the whole X screen.

const fs = require("node:fs");

function load(koffi) {
  const x11 = koffi.load("libX11.so.6");
  const xtst = koffi.load("libXtst.so.6");

  // XClientMessageEvent, padded to the size of an XEvent (192 bytes on 64-bit), for XSendEvent.
  koffi.struct("OOVI_XCLIENT", {
    type: "int",
    serial: "ulong",
    send_event: "int",
    display: "void *",
    window: "ulong",
    message_type: "ulong",
    format: "int",
    data: koffi.array("long", 5),
    pad: koffi.array("uint8", 96),
  });
  const ErrorHandler = koffi.proto("int OoviXErrorHandler(void *display, void *event)");

  const fn = {
    XOpenDisplay: x11.func("void *XOpenDisplay(const char *name)"),
    XDefaultRootWindow: x11.func("ulong XDefaultRootWindow(void *display)"),
    XDefaultScreen: x11.func("int XDefaultScreen(void *display)"),
    XInternAtom: x11.func("ulong XInternAtom(void *display, const char *name, int only_if_exists)"),
    XGetWindowProperty: x11.func(
      "int XGetWindowProperty(void *display, ulong w, ulong property, long offset, long length, int del, ulong req_type, _Out_ ulong *actual_type, _Out_ int *actual_format, _Out_ ulong *nitems, _Out_ ulong *bytes_after, _Out_ void **prop)",
    ),
    XFree: x11.func("int XFree(void *data)"),
    XGetGeometry: x11.func("int XGetGeometry(void *display, ulong d, _Out_ ulong *root, _Out_ int *x, _Out_ int *y, _Out_ uint *width, _Out_ uint *height, _Out_ uint *border, _Out_ uint *depth)"),
    XTranslateCoordinates: x11.func("int XTranslateCoordinates(void *display, ulong src, ulong dest, int x, int y, _Out_ int *dx, _Out_ int *dy, _Out_ ulong *child)"),
    XSendEvent: x11.func("int XSendEvent(void *display, ulong w, int propagate, long mask, OOVI_XCLIENT *event)"),
    XIconifyWindow: x11.func("int XIconifyWindow(void *display, ulong w, int screen)"),
    XWarpPointer: x11.func("int XWarpPointer(void *display, ulong src, ulong dest, int sx, int sy, uint sw, uint sh, int dx, int dy)"),
    XFlush: x11.func("int XFlush(void *display)"),
    XSync: x11.func("int XSync(void *display, int discard)"),
    XSetErrorHandler: x11.func("void *XSetErrorHandler(OoviXErrorHandler *handler)"),
    XDisplayKeycodes: x11.func("int XDisplayKeycodes(void *display, _Out_ int *min, _Out_ int *max)"),
    XGetKeyboardMapping: x11.func("void *XGetKeyboardMapping(void *display, uint8 first, int count, _Out_ int *per)"),
    XChangeKeyboardMapping: x11.func("int XChangeKeyboardMapping(void *display, int first, int per, ulong *syms, int count)"),
    XTestFakeKeyEvent: xtst.func("int XTestFakeKeyEvent(void *display, uint keycode, int is_press, ulong delay)"),
  };

  // XRes tells which process owns any window, also those that don't publish _NET_WM_PID (older toolkits,
  // some Java apps). Optional: without it, such windows are judged by their title and class only.
  let xres = null;
  try {
    const lib = koffi.load("libXRes.so.1");
    koffi.struct("OOVI_XRES_SPEC", { client: "ulong", mask: "uint" });
    koffi.struct("OOVI_XRES_VALUE", { client: "ulong", mask: "uint", length: "long", value: "void *" });
    xres = {
      query: lib.func("int XResQueryClientIds(void *display, long n, OOVI_XRES_SPEC *specs, _Out_ long *count, _Out_ void **ids)"),
      destroy: lib.func("void XResClientIdsDestroy(long count, void *ids)"),
    };
  } catch {
    xres = null;
  }

  // A window that closes while oovi reads it is normal: Xlib's default would end the whole app.
  const onError = koffi.register(() => 0, koffi.pointer(ErrorHandler));
  fn.XSetErrorHandler(onError);

  const dpy = fn.XOpenDisplay(null);
  if (!dpy) throw new Error("Can't reach the X display.");
  const root = fn.XDefaultRootWindow(dpy);
  const screenNo = fn.XDefaultScreen(dpy);
  const atoms = new Map();
  const atom = (name) => {
    if (!atoms.has(name)) atoms.set(name, fn.XInternAtom(dpy, name, 0));
    return atoms.get(name);
  };
  const AnyPropertyType = 0;

  /** A window property: { type, format, bytes } (null when missing). */
  function prop(w, name, max = 4096) {
    const type = [0];
    const format = [0];
    const n = [0];
    const after = [0];
    const ptr = [null];
    const ok = fn.XGetWindowProperty(dpy, w, atom(name), 0, max, 0, AnyPropertyType, type, format, n, after, ptr);
    if (ok !== 0 || !ptr[0]) return null;
    try {
      const count = Number(n[0]);
      // Format 32 properties come back as C longs (8 bytes each on 64-bit).
      const size = format[0] === 32 ? count * 8 : format[0] === 16 ? count * 2 : count;
      const bytes = size > 0 ? Buffer.from(koffi.decode(ptr[0], koffi.array("uint8", size))) : Buffer.alloc(0);
      return { type: Number(type[0]), format: format[0], count, bytes };
    } finally {
      fn.XFree(ptr[0]);
    }
  }
  const longs = (w, name) => {
    const p = prop(w, name);
    if (!p || p.format !== 32) return [];
    const out = [];
    for (let i = 0; i < p.count; i++) out.push(Number(p.bytes.readBigUInt64LE(i * 8)));
    return out;
  };
  const text = (w, name) => {
    const p = prop(w, name);
    return p && p.format === 8 ? p.bytes.toString(p.type === atom("UTF8_STRING") ? "utf8" : "latin1").replace(/\0+$/, "") : "";
  };
  const atomName = (() => {
    // XGetAtomName is avoided (it allocates): the few types oovi cares about are compared by value.
    return (a) => [...atoms.entries()].find(([, v]) => v === a)?.[0] ?? "";
  })();
  for (const n of ["_NET_WM_WINDOW_TYPE_NORMAL", "_NET_WM_WINDOW_TYPE_DIALOG", "_NET_WM_WINDOW_TYPE_DOCK", "_NET_WM_WINDOW_TYPE_DESKTOP", "_NET_WM_WINDOW_TYPE_UTILITY", "_NET_WM_WINDOW_TYPE_TOOLBAR", "_NET_WM_WINDOW_TYPE_SPLASH", "_NET_WM_WINDOW_TYPE_MENU", "_NET_WM_STATE_HIDDEN", "_NET_WM_STATE_MAXIMIZED_VERT", "_NET_WM_STATE_MAXIMIZED_HORZ", "_NET_WM_STATE_SKIP_TASKBAR"]) atom(n);

  // ---- the program behind a window ----
  const myUid = typeof process.getuid === "function" ? process.getuid() : -1;
  function proc(pid) {
    if (!pid) return { exe: "", own: false, elevated: false };
    let exe = "";
    try {
      exe = fs.readlinkSync(`/proc/${pid}/exe`).split("/").pop() || "";
    } catch {
      // Another user's process (root): its program can't be read, which already says enough.
      try {
        exe = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      } catch {
        exe = "";
      }
    }
    let uid = myUid;
    try {
      const m = /^Uid:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
      if (m) uid = Number(m[1]);
    } catch {
      /* unreadable: treated as this user's */
    }
    return { exe: exe.replace(/ \(deleted\)$/, ""), own: pid === process.pid, elevated: myUid >= 0 && uid !== myUid };
  }

  function pidByXRes(w) {
    if (!xres) return 0;
    const count = [0];
    const ids = [null];
    try {
      if (xres.query(dpy, 1, [{ client: w, mask: 2 /* XRES_CLIENT_ID_PID_MASK */ }], count, ids) !== 0 || !ids[0]) return 0;
      const list = koffi.decode(ids[0], koffi.array("OOVI_XRES_VALUE", Number(count[0])));
      const hit = list.find((v) => v.mask === 2 && v.value && Number(v.length) >= 4);
      const pid = hit ? Number(koffi.decode(hit.value, "uint32")) : 0;
      xres.destroy(Number(count[0]), ids[0]);
      return pid;
    } catch {
      return 0;
    }
  }

  /** The window's outer box (frame included) in screen pixels. */
  function rectOf(w) {
    const r = [0];
    const x = [0];
    const y = [0];
    const width = [0];
    const height = [0];
    const b = [0];
    const d = [0];
    if (!fn.XGetGeometry(dpy, w, r, x, y, width, height, b, d)) return null;
    const ax = [0];
    const ay = [0];
    const child = [0];
    if (!fn.XTranslateCoordinates(dpy, w, root, 0, 0, ax, ay, child)) return null;
    const [left = 0, right = 0, top = 0, bottom = 0] = longs(w, "_NET_FRAME_EXTENTS");
    return { x: ax[0] - left, y: ay[0] - top, width: width[0] + left + right, height: height[0] + top + bottom };
  }

  const states = (w) => new Set(longs(w, "_NET_WM_STATE").map(atomName));
  const types = (w) => longs(w, "_NET_WM_WINDOW_TYPE").map(atomName);
  const onDesktop = (w) => {
    const [cur] = longs(root, "_NET_CURRENT_DESKTOP");
    const [mine] = longs(w, "_NET_WM_DESKTOP");
    return cur === undefined || mine === undefined || mine === cur || mine === 0xffffffff;
  };

  function info(w) {
    if (!w) return null;
    const rect = rectOf(w);
    if (!rect) return null;
    const cls = text(w, "WM_CLASS").split("\0").filter(Boolean);
    const [pid] = longs(w, "_NET_WM_PID");
    const p = proc(pid || pidByXRes(w));
    return { handle: w, title: text(w, "_NET_WM_NAME") || text(w, "WM_NAME"), className: cls[1] || cls[0] || "", exe: p.exe, own: p.own, elevated: p.elevated, rect };
  }

  /** Managed windows, top of the stacking order first. */
  const stacking = () => longs(root, "_NET_CLIENT_LIST_STACKING").reverse();

  function clientMessage(w, type, data) {
    const ev = { type: 33 /* ClientMessage */, serial: 0, send_event: 1, display: dpy, window: w, message_type: atom(type), format: 32, data: [...data, 0, 0, 0, 0, 0].slice(0, 5), pad: new Array(96).fill(0) };
    // SubstructureRedirectMask | SubstructureNotifyMask: how window managers expect these requests.
    const ok = fn.XSendEvent(dpy, root, 0, (1 << 20) | (1 << 19), ev);
    fn.XFlush(dpy);
    return ok !== 0;
  }

  // ---- typing ----
  /** A key code no key uses, borrowed while typing (as xdotool does). */
  let scratch = null;
  function scratchKey() {
    if (scratch !== null) return scratch;
    const min = [0];
    const max = [0];
    fn.XDisplayKeycodes(dpy, min, max);
    const per = [0];
    const count = max[0] - min[0] + 1;
    const map = fn.XGetKeyboardMapping(dpy, min[0], count, per);
    if (!map) return null;
    try {
      const syms = koffi.decode(map, koffi.array("ulong", count * per[0]));
      for (let k = count - 1; k >= 0; k--) {
        let empty = true;
        for (let j = 0; j < per[0]; j++) if (Number(syms[k * per[0] + j]) !== 0) empty = false;
        if (empty) {
          scratch = min[0] + k;
          break;
        }
      }
    } finally {
      fn.XFree(map);
    }
    return scratch;
  }
  const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  /** The X keysym for a character: Latin-1 as is, Enter and Tab as keys, everything else as Unicode. */
  const keysym = (ch) => {
    if (ch === "\n") return 0xff0d;
    if (ch === "\t") return 0xff09;
    const cp = ch.codePointAt(0);
    return cp >= 0x20 && cp <= 0xff ? cp : 0x1000000 + cp;
  };
  function typeText(s) {
    const code = scratchKey();
    if (code === null) return "No free key to type with on this keyboard.";
    try {
      for (const ch of String(s).replace(/\r\n?/g, "\n")) {
        const sym = keysym(ch);
        fn.XChangeKeyboardMapping(dpy, code, 2, [sym, sym], 1);
        fn.XSync(dpy, 0);
        fn.XTestFakeKeyEvent(dpy, code, 1, 0);
        fn.XTestFakeKeyEvent(dpy, code, 0, 0);
        fn.XSync(dpy, 0);
        // Apps read the key with the mapping of the moment: a short wait before the next one changes it.
        pause(12);
      }
    } finally {
      fn.XChangeKeyboardMapping(dpy, code, 2, [0, 0], 1);
      fn.XSync(dpy, 0);
    }
    return "";
  }

  const find = (handle) => longs(root, "_NET_CLIENT_LIST").find((w) => w === Number(handle)) || null;
  const isAppWindow = (w) => {
    const t = types(w);
    return !t.some((x) => /_(DOCK|DESKTOP|SPLASH|MENU|TOOLBAR)$/.test(x)) && !states(w).has("_NET_WM_STATE_SKIP_TASKBAR");
  };

  return {
    typeText,
    setCursor(x, y) {
      fn.XWarpPointer(dpy, 0, root, 0, 0, 0, 0, Math.round(x), Math.round(y));
      fn.XFlush(dpy);
      return true;
    },
    appWindows() {
      return stacking()
        .filter(isAppWindow)
        .map((w) => {
          const i = info(w);
          if (!i || !i.title) return null;
          const s = states(w);
          return { ...i, minimized: s.has("_NET_WM_STATE_HIDDEN"), maximized: s.has("_NET_WM_STATE_MAXIMIZED_VERT") && s.has("_NET_WM_STATE_MAXIMIZED_HORZ") };
        })
        .filter(Boolean);
    },
    act(handle, action) {
      const w = find(handle);
      if (!w) return "That window isn't open any more.";
      const ADD = 1;
      const REMOVE = 0;
      const max = [atom("_NET_WM_STATE_MAXIMIZED_VERT"), atom("_NET_WM_STATE_MAXIMIZED_HORZ")];
      if (action === "close") return clientMessage(w, "_NET_CLOSE_WINDOW", [0, 2]) ? "" : "The window manager didn't accept the request to close it.";
      if (action === "minimize") return fn.XIconifyWindow(dpy, w, screenNo) ? (fn.XFlush(dpy), "") : "The window manager didn't minimize it.";
      if (action === "maximize") return clientMessage(w, "_NET_WM_STATE", [ADD, ...max, 2]) ? "" : "The window manager didn't maximize it.";
      if (action === "restore") {
        clientMessage(w, "_NET_WM_STATE", [REMOVE, ...max, 2]);
        clientMessage(w, "_NET_ACTIVE_WINDOW", [2, 0, 0]);
        return "";
      }
      if (action === "switch") {
        clientMessage(w, "_NET_ACTIVE_WINDOW", [2, 0, 0]);
        pause(150);
        return longs(root, "_NET_ACTIVE_WINDOW")[0] === w ? "" : "The window manager didn't bring it to the front.";
      }
      return "Unknown action.";
    },
    foreground() {
      const [w] = longs(root, "_NET_ACTIVE_WINDOW");
      return w ? info(w) : null;
    },
    windowAt(x, y) {
      for (const w of stacking()) {
        if (states(w).has("_NET_WM_STATE_HIDDEN") || !onDesktop(w)) continue;
        const r = rectOf(w);
        if (r && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) return info(w);
      }
      return null;
    },
    visibleWindows(maxCount = 200) {
      return stacking()
        .filter((w) => !states(w).has("_NET_WM_STATE_HIDDEN") && onDesktop(w))
        .slice(0, maxCount)
        .map(info)
        .filter((w) => w && w.rect.width > 0 && w.rect.height > 0);
    },
  };
}

module.exports = { load };
