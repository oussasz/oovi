// Win32 window facts for desktop control, through koffi (FFI to user32/kernel32/advapi32/dwmapi):
// which top-level window is under a point (what a click really hits), the foreground window
// (what keys really reach), the visible windows in z-order (to black out private ones in
// screenshots), and for each: its Unicode title, class, process name and whether it runs elevated.
// libnut can't do this (ANSI titles only, no visibility, no process).
// Coordinates are physical pixels: Electron's main process is per-monitor DPI aware.

function load(koffi) {
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const dwmapi = koffi.load("dwmapi.dll");

  koffi.struct("OOVI_POINT", { x: "long", y: "long" });
  koffi.struct("OOVI_RECT", { left: "long", top: "long", right: "long", bottom: "long" });
  const EnumProc = koffi.proto("bool __stdcall OoviEnumProc(void *hwnd, intptr_t lparam)");

  const fn = {
    GetForegroundWindow: user32.func("void * __stdcall GetForegroundWindow()"),
    WindowFromPoint: user32.func("void * __stdcall WindowFromPoint(OOVI_POINT pt)"),
    GetAncestor: user32.func("void * __stdcall GetAncestor(void *hwnd, uint32_t flags)"),
    GetWindowTextW: user32.func("int __stdcall GetWindowTextW(void *hwnd, _Out_ uint8_t *buf, int max)"),
    GetClassNameW: user32.func("int __stdcall GetClassNameW(void *hwnd, _Out_ uint8_t *buf, int max)"),
    GetWindowThreadProcessId: user32.func("uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)"),
    IsWindowVisible: user32.func("bool __stdcall IsWindowVisible(void *hwnd)"),
    IsIconic: user32.func("bool __stdcall IsIconic(void *hwnd)"),
    GetWindowRect: user32.func("bool __stdcall GetWindowRect(void *hwnd, _Out_ OOVI_RECT *rect)"),
    EnumWindows: user32.func("bool __stdcall EnumWindows(OoviEnumProc *cb, intptr_t lparam)"),
    OpenProcess: kernel32.func("void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)"),
    CloseHandle: kernel32.func("bool __stdcall CloseHandle(void *h)"),
    QueryFullProcessImageNameW: kernel32.func("bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)"),
    GetCurrentProcessId: kernel32.func("uint32_t __stdcall GetCurrentProcessId()"),
    OpenProcessToken: advapi32.func("bool __stdcall OpenProcessToken(void *h, uint32_t access, _Out_ void **token)"),
    GetTokenInformation: advapi32.func("bool __stdcall GetTokenInformation(void *token, int cls, _Out_ uint8_t *buf, uint32_t len, _Out_ uint32_t *ret)"),
    DwmGetWindowAttribute: dwmapi.func("int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ uint8_t *buf, uint32_t size)"),
  };

  // Switching, minimizing and closing windows (manage_window). Declared apart: if any of these can't be
  // bound on some Windows version, only manage_window is off; screenshots, clicks and typing still work.
  const more = {};
  let moreError = null;
  try {
    Object.assign(more, {
      ShowWindow: user32.func("bool __stdcall ShowWindow(void *hwnd, int cmd)"),
      SetForegroundWindow: user32.func("bool __stdcall SetForegroundWindow(void *hwnd)"),
      BringWindowToTop: user32.func("bool __stdcall BringWindowToTop(void *hwnd)"),
      PostMessageW: user32.func("bool __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t wparam, intptr_t lparam)"),
      IsWindow: user32.func("bool __stdcall IsWindow(void *hwnd)"),
      IsZoomed: user32.func("bool __stdcall IsZoomed(void *hwnd)"),
      GetWindow: user32.func("void * __stdcall GetWindow(void *hwnd, uint32_t cmd)"),
      GetWindowLongW: user32.func("int32_t __stdcall GetWindowLongW(void *hwnd, int index)"),
      keybd_event: user32.func("void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)"),
      // Typing text as characters (KEYEVENTF_UNICODE), whatever the keyboard layout: Arabic, French, emoji.
      SendInput: user32.func("uint32_t __stdcall SendInput(uint32_t count, uint8_t *inputs, int size)"),
      // The pointer anywhere on any screen (real pixels of the whole desktop; screens left of or above
      // the main one have negative positions).
      SetCursorPos: user32.func("bool __stdcall SetCursorPos(int x, int y)"),
    });
  } catch (e) {
    moreError = String((e && e.message) || e);
  }
  const need = () => {
    if (moreError) throw new Error(`Managing windows isn't available on this computer: ${moreError}`);
    return more;
  };

  const GA_ROOT = 2;
  const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
  const TOKEN_QUERY = 0x0008;
  const TokenElevation = 20;
  const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const DWMWA_CLOAKED = 14;
  const self = fn.GetCurrentProcessId();

  const num = (h) => (h ? Number(koffi.address(h)) : 0);
  const text = (f, h) => {
    const buf = Buffer.alloc(1024);
    const n = f(h, buf, 512);
    return n > 0 ? buf.toString("utf16le", 0, n * 2) : "";
  };

  /** Process facts for a pid, cached briefly (the same few windows are asked about over and over). */
  const procCache = new Map();
  function proc(pid) {
    const hit = procCache.get(pid);
    if (hit && Date.now() - hit.at < 5000) return hit.v;
    let v = { exe: "", denied: false, elevated: false };
    const h = fn.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!h) v = { exe: "", denied: true, elevated: true };
    else {
      try {
        const buf = Buffer.alloc(2048);
        const size = [1024];
        if (fn.QueryFullProcessImageNameW(h, 0, buf, size)) {
          const full = buf.toString("utf16le", 0, size[0] * 2);
          v.exe = full.split("\\").pop().toLowerCase();
        }
        const tok = [null];
        if (!fn.OpenProcessToken(h, TOKEN_QUERY, tok)) v.elevated = true;
        else {
          try {
            const out = Buffer.alloc(4);
            const len = [0];
            v.elevated = fn.GetTokenInformation(tok[0], TokenElevation, out, 4, len) ? out.readUInt32LE(0) !== 0 : true;
          } finally {
            fn.CloseHandle(tok[0]);
          }
        }
      } finally {
        fn.CloseHandle(h);
      }
    }
    procCache.set(pid, { at: Date.now(), v });
    return v;
  }

  function rectOf(h) {
    const b = Buffer.alloc(16);
    let r = null;
    if (fn.DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, b, 16) === 0) r = { left: b.readInt32LE(0), top: b.readInt32LE(4), right: b.readInt32LE(8), bottom: b.readInt32LE(12) };
    else {
      const o = {};
      if (fn.GetWindowRect(h, o)) r = o;
    }
    return r ? { x: r.left, y: r.top, width: Math.max(0, r.right - r.left), height: Math.max(0, r.bottom - r.top) } : { x: 0, y: 0, width: 0, height: 0 };
  }

  function info(h) {
    if (!h) return null;
    const pid = [0];
    fn.GetWindowThreadProcessId(h, pid);
    const p = pid[0] === self ? { exe: "", denied: false, elevated: false } : proc(pid[0]);
    return {
      handle: num(h),
      title: text(fn.GetWindowTextW, h),
      className: text(fn.GetClassNameW, h),
      pid: pid[0],
      own: pid[0] === self,
      exe: p.exe,
      elevated: p.elevated,
      rect: rectOf(h),
    };
  }

  function cloaked(h) {
    const b = Buffer.alloc(4);
    return fn.DwmGetWindowAttribute(h, DWMWA_CLOAKED, b, 4) === 0 && b.readUInt32LE(0) !== 0;
  }

  const GW_OWNER = 4;
  const GWL_EXSTYLE = -20;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_NOACTIVATE = 0x08000000;
  const SW = { minimize: 6, maximize: 3, restore: 9 };
  const WM_CLOSE = 0x0010;
  const VK_MENU = 0x12;
  const KEYEVENTF_KEYUP = 0x2;

  /** The windows a person sees in the taskbar and Alt+Tab: titled, not owned, not tool windows, not cloaked. */
  function appWindows(max = 300) {
    const handles = [];
    fn.EnumWindows((h) => {
      if (fn.IsWindowVisible(h) && !cloaked(h) && !need().GetWindow(h, GW_OWNER)) {
        const ex = need().GetWindowLongW(h, GWL_EXSTYLE) >>> 0;
        if (!(ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_NOACTIVATE) && text(fn.GetWindowTextW, h)) handles.push(h);
      }
      return handles.length < max;
    }, 0);
    return handles;
  }
  // ---- typing text ----
  // One INPUT structure per key event, as 64-bit Windows lays it out: 40 bytes, type at 0, then the
  // KEYBDINPUT at 8 (wVk 8, wScan 10, dwFlags 12, time 16, dwExtraInfo 24).
  const INPUT_SIZE = 40;
  const INPUT_KEYBOARD = 1;
  const KEYEVENTF_UNICODE = 0x4;
  const KEYEVENTF_KEYUP_ = 0x2;
  const VK_RETURN = 0x0d;
  const VK_TAB = 0x09;
  /** Key events for some text: characters as Unicode units (a surrogate pair is two), Enter and Tab as keys. */
  function keyEvents(text) {
    const out = [];
    for (const ch of String(text).replace(/\r\n?/g, "\n")) {
      if (ch === "\n" || ch === "\t") {
        const vk = ch === "\n" ? VK_RETURN : VK_TAB;
        out.push({ vk, scan: 0, flags: 0 }, { vk, scan: 0, flags: KEYEVENTF_KEYUP_ });
        continue;
      }
      for (let i = 0; i < ch.length; i++) {
        const unit = ch.charCodeAt(i);
        out.push({ vk: 0, scan: unit, flags: KEYEVENTF_UNICODE }, { vk: 0, scan: unit, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP_ });
      }
    }
    return out;
  }
  const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  /** Types the text into the window that has the keyboard. Returns "" or an error text. */
  function typeText(text) {
    const events = keyEvents(text);
    // In small batches: some apps (web pages above all) drop characters that arrive all at once.
    for (let at = 0; at < events.length; at += 32) {
      const batch = events.slice(at, at + 32);
      const buf = Buffer.alloc(INPUT_SIZE * batch.length);
      batch.forEach((e, i) => {
        const o = i * INPUT_SIZE;
        buf.writeUInt32LE(INPUT_KEYBOARD, o);
        buf.writeUInt16LE(e.vk, o + 8);
        buf.writeUInt16LE(e.scan, o + 10);
        buf.writeUInt32LE(e.flags, o + 12);
      });
      const sent = need().SendInput(batch.length, buf, INPUT_SIZE);
      if (sent !== batch.length) return "Windows refused the typing (the window may run as administrator, or a protected screen is in front).";
      pause(8);
    }
    return "";
  }

  /** The live handle behind a number from a list (handles are never taken from outside as pointers). */
  const find = (handle) => appWindows().find((h) => num(h) === Number(handle)) || null;

  return {
    typeText,
    /** Moves the pointer to x, y (real pixels of the whole desktop). Returns false when it couldn't. */
    setCursor(x, y) {
      if (moreError) return false;
      return !!more.SetCursorPos(Math.round(x), Math.round(y));
    },
    /** Windows the user could switch to, top of the z-order first, with minimized: true for those in the taskbar only. */
    appWindows() {
      return appWindows()
        .map((h) => {
          const w = info(h);
          return w ? { ...w, minimized: !!fn.IsIconic(h), maximized: !!need().IsZoomed(h) } : null;
        })
        .filter(Boolean);
    },
    /**
     * Bring to the front, minimize, maximize, restore or ask to close one of those windows. Returns "" or
     * an error text. Closing is a polite request (WM_CLOSE): the app may first ask to save.
     */
    act(handle, action) {
      const h = find(handle);
      if (!h) return "That window isn't open any more.";
      if (action === "close") return need().PostMessageW(h, WM_CLOSE, 0, 0) ? "" : "Windows didn't accept the request to close it.";
      if (action === "minimize" || action === "maximize" || action === "restore") {
        need().ShowWindow(h, SW[action]);
        return "";
      }
      if (action === "switch") {
        if (fn.IsIconic(h)) need().ShowWindow(h, SW.restore);
        // Windows only lets a program bring a window to the front right after a key press of its own:
        // a lone Alt press (no other key) does that without doing anything else.
        need().keybd_event(VK_MENU, 0, 0, 0);
        need().keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
        need().BringWindowToTop(h);
        need().SetForegroundWindow(h);
        return num(fn.GetForegroundWindow()) === num(h) ? "" : "Windows didn't let oovi bring it to the front.";
      }
      return "Unknown action.";
    },
    /** The window that receives the keyboard. */
    foreground() {
      return info(fn.GetForegroundWindow());
    },
    /** The top-level window a click at (x, y) lands on. */
    windowAt(x, y) {
      const h = fn.WindowFromPoint({ x: Math.round(x), y: Math.round(y) });
      return info(h ? fn.GetAncestor(h, GA_ROOT) || h : null);
    },
    /** Visible, uncloaked, non-minimized top-level windows, top of the z-order first. */
    visibleWindows(max = 200) {
      const handles = [];
      fn.EnumWindows((h) => {
        if (fn.IsWindowVisible(h) && !fn.IsIconic(h) && !cloaked(h)) handles.push(h);
        return handles.length < max;
      }, 0);
      return handles.map(info).filter((w) => w && w.rect.width > 0 && w.rect.height > 0);
    },
  };
}

module.exports = { load };
