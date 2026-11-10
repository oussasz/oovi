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

  return {
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
