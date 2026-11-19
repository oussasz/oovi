"use client";

// iOS-style building blocks: bars that blur and collapse their large title on scroll, the tab bar, inset grouped
// lists, action sheets, sheets, swipe actions, pull to refresh, toasts. Sizes are in rem (they follow the phone's
// text size on iPhone, see m.css) and every touch target is at least 44 pt.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import FaceView, { FaceStack } from "@/components/Face";
import { Sparkle } from "@/components/Doodles";
import type { Mood } from "@/lib/faces";
import { tap } from "../_lib/haptics";
import { Icon, type IconName } from "./Icon";
import { canGoBack, useM } from "./MobileApp";
import { to } from "../_lib/route";

// ---------- scrolling ----------

/**
 * On wide screens (the web version, a tablet) each column scrolls on its own: the column's element. On a phone,
 * null: the page itself scrolls.
 */
export const PaneCtx = createContext<HTMLElement | null>(null);
export const usePane = () => useContext(PaneCtx);

/** Wide enough for two columns (chat list + chat), like WhatsApp Web. */
export const WIDE = "(min-width: 900px)";
export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const q = window.matchMedia(WIDE);
    const on = () => setWide(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return wide;
}

/** True once the page (or its column) scrolled past `px` (the large title is then shown small in the bar). */
export function useScrolledPast(px: number): boolean {
  const [past, setPast] = useState(false);
  const pane = usePane();
  useEffect(() => {
    let raf = 0;
    const target: HTMLElement | Window = pane ?? window;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPast((pane ? pane.scrollTop : window.scrollY) > px));
    };
    on();
    target.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      target.removeEventListener("scroll", on);
    };
  }, [px, pane]);
  return past;
}

// ---------- bars ----------

export function NavBar({
  title,
  large = false,
  back,
  right,
  center,
  solid = false,
}: {
  title: string;
  large?: boolean;
  back?: { href: string; label: string };
  right?: ReactNode;
  center?: ReactNode;
  solid?: boolean;
}) {
  const scrolled = useScrolledPast(large ? 44 : 2);
  const router = useRouter();
  const showSmall = !large || scrolled;
  return (
    <header className={`m-nav${scrolled || solid ? " m-nav--bar" : ""}`}>
      <div className="m-nav__row">
        <div className="m-nav__side">
          {back && (
            <button
              type="button"
              className="m-nav__back"
              aria-label={back.label}
              onClick={() => {
                tap();
                if (canGoBack()) router.back();
                else router.push(back.href);
              }}
            >
              <Icon name="back" size={26} stroke={2.3} className="m-flip" />
              <span>{back.label}</span>
            </button>
          )}
        </div>
        <div className={`m-nav__title${showSmall ? " is-on" : ""}`} aria-hidden={!showSmall && large}>
          {center ?? <span className="m-nav__text">{title}</span>}
        </div>
        <div className="m-nav__side m-nav__side--end">{right}</div>
      </div>
    </header>
  );
}

/** The screen's title, in oovi's heavy rounded type, with the website's little sparkle. */
export function LargeTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-large">
      {children}
      <Sparkle className="m-large__spark" size={18} />
    </h1>
  );
}

/** One of the logo's soft pebbles, used behind icons and the active tab. */
export const BLOB = "M50 17 C66 15 83 22 87 40 C91 58 86 80 66 88 C54 93 34 92 22 85 C10 77 9 58 14 44 C19 29 34 19 50 17 Z";
export function Blob({ color, className }: { color: string; className?: string }) {
  return (
    <svg className={className} viewBox="8 12 84 84" aria-hidden focusable="false">
      <path d={BLOB} fill={color} />
    </svg>
  );
}

/** The logo's three slimes (blue, yellow, coral), acting out a mood: empty states and sign-in. */
const TRIO = [
  { color: 0, shape: 0, hair: 0, eyes: 1, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 },
  { color: 1, shape: 1, hair: 0, eyes: 1, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 },
  { color: 2, shape: 3, hair: 0, eyes: 1, nose: 0, mouth: 0, cheeks: 0, top: 0, wear: 0 },
];
export function SlimeTrio({ mood = "idle", size = 120 }: { mood?: Mood; size?: number }) {
  return (
    <span className="m-trio" aria-hidden>
      <FaceStack faces={TRIO} size={size} moods={[mood, mood, mood]} />
    </span>
  );
}

// ---------- lists ----------

export function Section({ header, footer, children, id }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="m-section" aria-labelledby={header && id ? id : undefined}>
      {header && (
        <h2 className="m-section__head" id={id}>
          {header}
        </h2>
      )}
      <div className="m-group">{children}</div>
      {footer && <p className="m-section__foot">{footer}</p>}
    </section>
  );
}

/** A settings icon on a pastel pebble (the logo's colors), drawn in ink. */
export function IconTile({ name, color }: { name: IconName; color: string }) {
  return (
    <span className="m-tile">
      <Blob color={color} className="m-tile__blob" />
      <Icon name={name} size={18} stroke={2.2} />
    </span>
  );
}

export function Row({
  icon,
  title,
  sub,
  value,
  href,
  onClick,
  chevron,
  danger,
  external,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  external?: boolean;
}) {
  const body = (
    <>
      {icon && <span className="m-row__icon">{icon}</span>}
      <span className="m-row__main">
        <span className={`m-row__title${danger ? " is-danger" : ""}`}>{title}</span>
        {sub && <span className="m-row__sub">{sub}</span>}
      </span>
      {value !== undefined && <span className="m-row__value">{value}</span>}
      {(chevron || href) && !external && <Icon name="chevron" size={18} stroke={2.4} className="m-row__chev m-flip" />}
      {external && <Icon name="share" size={18} stroke={2} className="m-row__chev" />}
    </>
  );
  if (href && external)
    return (
      <a className="m-row is-tap" href={href} target="_blank" rel="noopener noreferrer" onClick={() => tap()}>
        {body}
      </a>
    );
  if (href)
    return (
      <Link className="m-row is-tap" href={href} onClick={() => tap()}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        className="m-row is-tap"
        onClick={() => {
          tap();
          onClick();
        }}
      >
        {body}
      </button>
    );
  return <div className="m-row">{body}</div>;
}

// ---------- faces ----------

export function BotFace({ face, size = 44, mood }: { face: Record<string, unknown> | object | undefined; size?: number; mood?: Mood }) {
  return <FaceView face={(face ?? {}) as Record<string, unknown>} size={size} mood={mood} />;
}

/** The signed-in person's picture (their account photo, or their initial on a pastel pebble). */
export function MeAvatar({ size = 36 }: { size?: number }) {
  const { me } = useM();
  const [broken, setBroken] = useState(false);
  // Their account photo: uploaded in Settings (a data URL, as the website keeps it) or from a sign-in provider.
  const img = me?.image && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,|\/api\/v1\/avatars\/)/.test(me.image) && !broken ? me.image : null;
  const letter = (me?.name || me?.email || "?").trim().slice(0, 1).toUpperCase();
  return (
    <span className="m-me" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {img ? <img src={img} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : letter}
    </span>
  );
}

export function ChatFace({ faces, size = 52, mood }: { faces: (Record<string, unknown> | object)[]; size?: number; mood?: Mood }) {
  if (faces.length <= 1) return <BotFace face={faces[0]} size={size} mood={mood} />;
  return <FaceStack faces={faces as Record<string, unknown>[]} size={size} />;
}

// ---------- sheets ----------

function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>("button, a, input, textarea")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && el) {
        const f = [...el.querySelectorAll<HTMLElement>("button, a, input, textarea")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    document.documentElement.classList.add("m-locked");
    return () => {
      document.removeEventListener("keydown", key);
      document.documentElement.classList.remove("m-locked");
      before?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

/** disabled + sub: something only the computer can do, shown with why (never hidden silently). */
export type SheetAction = { label: string; onPress: () => void; destructive?: boolean; bold?: boolean; checked?: boolean; disabled?: boolean; sub?: string };

/** iOS action sheet: a message, a group of choices, and Cancel apart. */
export function ActionSheet({ open, title, message, actions, onClose }: { open: boolean; title?: string; message?: string; actions: SheetAction[]; onClose: () => void }) {
  const { t } = useM();
  const ref = useDialogFocus(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="m-overlay" onClick={onClose}>
      <div ref={ref} className="m-asheet" role="dialog" aria-modal="true" aria-labelledby={title || message ? id : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="m-asheet__group">
          {(title || message) && (
            <div className="m-asheet__head" id={id}>
              {title && <b>{title}</b>}
              {message && <span>{message}</span>}
            </div>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`m-asheet__btn${a.destructive ? " is-danger" : ""}${a.bold ? " is-bold" : ""}${a.disabled ? " is-off" : ""}`}
              aria-pressed={a.checked === undefined ? undefined : a.checked}
              aria-disabled={a.disabled || undefined}
              onClick={() => {
                if (a.disabled) return;
                tap(a.destructive ? "warning" : "light");
                onClose();
                a.onPress();
              }}
            >
              <span className="m-asheet__text">
                <span>{a.label}</span>
                {a.sub && <small>{a.sub}</small>}
              </span>
              {a.disabled && <Icon name="laptop" size={18} />}
              {a.checked && <Icon name="check" size={20} stroke={2.4} />}
            </button>
          ))}
        </div>
        <button type="button" className="m-asheet__btn m-asheet__cancel" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

/** A card that slides up from the bottom, with a grabber and a title. */
export function Sheet({ open, title, onClose, children, closeLabel }: { open: boolean; title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const { t } = useM();
  const ref = useDialogFocus(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="m-overlay" onClick={onClose}>
      <div ref={ref} className="m-sheet" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet__grab" aria-hidden />
        <div className="m-sheet__head">
          <h2 id={id}>{title}</h2>
          <button type="button" className={`m-sheet__done${closeLabel ? " is-quiet" : ""}`} onClick={onClose}>
            {closeLabel ?? t("common.done")}
          </button>
        </div>
        <div className="m-sheet__body">{children}</div>
      </div>
    </div>
  );
}

// ---------- toast ----------

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef(0);
  const show = useCallback((m: string) => {
    window.clearTimeout(timer.current);
    setMsg(m);
    timer.current = window.setTimeout(() => setMsg(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = (
    <div className="m-toast-wrap" aria-live="polite" role="status">
      {msg && <div className="m-toast">{msg}</div>}
    </div>
  );
  return [node, show];
}

// ---------- pull to refresh ----------

export function usePullToRefresh(onRefresh: () => Promise<void> | void): ReactNode {
  const pane = usePane();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  useEffect(() => {
    // In a column of the wide layout (a computer or a tablet) there is no pull to refresh: the app refreshes by itself.
    if (pane) return;
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !busy ? e.touches[0]!.clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0]!.clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const p = Math.min(110, dy * 0.5);
      if (pullRef.current < 64 && p >= 64) tap();
      pullRef.current = p;
      setPull(p);
    };
    const up = async () => {
      const p = pullRef.current;
      start.current = null;
      pullRef.current = 0;
      setPull(0);
      if (p >= 64) {
        setBusy(true);
        try {
          await onRefresh();
        } finally {
          setBusy(false);
        }
      }
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [onRefresh, busy, pane]);
  if (pane) return null;
  const h = busy ? 52 : pull;
  return (
    <div className="m-ptr" style={{ height: h }} aria-hidden={!busy}>
      {(busy || pull > 8) && <Spinner progress={busy ? undefined : Math.min(1, pull / 64)} />}
    </div>
  );
}

/** Three little pebbles hopping (oovi's "working"). With `progress` (pull to refresh) they grow as you pull. */
export function Spinner({ progress, size = 22 }: { progress?: number; size?: number }) {
  const d = Math.max(6, Math.round(size / 3));
  return (
    <span className={`m-spin${progress === undefined ? " is-busy" : ""}`} style={{ height: size, gap: d / 2 }} role="progressbar" aria-busy="true" aria-label="…">
      {[0, 1, 2].map((i) => (
        <i key={i} style={{ width: d, height: d, transform: progress === undefined ? undefined : `scale(${Math.min(1, Math.max(0, progress * 3 - i))})` }} />
      ))}
    </span>
  );
}

// ---------- swipe actions ----------

export type SwipeAction = { label: string; icon: IconName; color: string; onPress: () => void };

/**
 * A list row with actions under each side, like Mail and WhatsApp: swipe from the start edge for `lead`, from the
 * end edge for `trail` (mirrored in Arabic). Half a swipe shows the actions, a long swipe does the outermost one.
 * Long press (or the hidden "More actions" button for keyboards and screen readers) opens `onMore`.
 */
export function SwipeRow({ lead = [], trail = [], children, onMore, moreLabel }: { lead?: SwipeAction[]; trail?: SwipeAction[]; children: ReactNode; onMore?: () => void; moreLabel: string }) {
  const { dir } = useM();
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const s = useRef<{ x: number; y: number; base: number; lock: "h" | "v" | null } | null>(null);
  const press = useRef(0);
  const W = 78;
  const sign = dir === "rtl" ? -1 : 1;
  const openL = W * lead.length;
  const openT = W * trail.length;
  const done = (a: SwipeAction | undefined) => {
    setX(0);
    if (a) {
      tap("medium");
      a.onPress();
    }
  };
  const side = (acts: SwipeAction[], cls: string, width: number) =>
    acts.length ? (
      <div className={`m-swipe__acts ${cls}`} style={{ width }} aria-hidden>
        {acts.map((a) => (
          <button key={a.label} type="button" className="m-swipe__act" style={{ background: a.color }} tabIndex={-1} onClick={() => done(a)}>
            <Icon name={a.icon} size={22} stroke={2.2} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    ) : null;
  return (
    <div className="m-swipe">
      {side(lead, "m-swipe__acts--lead", Math.max(openL, x * sign))}
      {side(trail, "m-swipe__acts--trail", Math.max(openT, -x * sign))}
      <div
        className={`m-swipe__body${drag ? " is-drag" : ""}`}
        style={{ transform: x ? `translate3d(${x}px,0,0)` : undefined }}
        onTouchStart={(e) => {
          const p = e.touches[0]!;
          s.current = { x: p.clientX, y: p.clientY, base: x, lock: null };
          if (onMore)
            press.current = window.setTimeout(() => {
              if (s.current && !s.current.lock) {
                s.current = null;
                tap("medium");
                onMore();
              }
            }, 520);
        }}
        onTouchMove={(e) => {
          const st = s.current;
          if (!st) return;
          const p = e.touches[0]!;
          const dx = p.clientX - st.x;
          const dy = p.clientY - st.y;
          if (!st.lock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            st.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
            window.clearTimeout(press.current);
          }
          if (st.lock !== "h") return;
          let nx = st.base + dx;
          if (nx * sign > 0 && !lead.length) nx = 0;
          if (nx * sign < 0 && !trail.length) nx = 0;
          setDrag(true);
          setX(Math.max(-320, Math.min(320, nx)));
        }}
        onTouchEnd={() => {
          window.clearTimeout(press.current);
          const st = s.current;
          s.current = null;
          setDrag(false);
          if (!st || st.lock !== "h") return;
          const v = x * sign;
          if (v > openL + 90) done(lead[0]);
          else if (v < -(openT + 90)) done(trail[0]);
          else if (v > openL / 2) setX(openL * sign);
          else if (v < -openT / 2) setX(-openT * sign);
          else setX(0);
        }}
        onClickCapture={(e) => {
          if (x !== 0) {
            e.preventDefault();
            e.stopPropagation();
            setX(0);
          }
        }}
        onContextMenu={(e) => {
          if (onMore) {
            e.preventDefault();
            onMore();
          }
        }}
      >
        {children}
      </div>
      {onMore && (
        <button type="button" className="m-sr-only m-sr-focus" onClick={onMore}>
          {moreLabel}
        </button>
      )}
    </div>
  );
}

// ---------- empty states ----------

export function Empty({ icon, art, title, body, children }: { icon?: ReactNode; art?: ReactNode; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="m-empty">
      {art ? <div className="m-empty__art">{art}</div> : icon && <div className="m-empty__icon">{icon}</div>}
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}

export function OfflineBar() {
  const { online, t } = useM();
  if (online) return null;
  return (
    <div className="m-offline" role="status">
      <Icon name="wifiOff" size={18} />
      <span>{t("common.offline")}</span>
    </div>
  );
}

/** The iOS switch (on/off). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`m-switch${on ? " is-on" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        tap("medium");
        onChange(!on);
      }}
    >
      <i />
    </button>
  );
}

/** A connector's picture: its logo when the catalog has one, else its first letter. */
export function ConnectorLogo({ name, logo, size = 29 }: { name: string; logo?: string; size?: number }) {
  if (logo && /^\/(logos|api\/v1\/avatars)\/[\w.-]+$/.test(logo))
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="m-clogo" src={logo} alt="" width={size} height={size} loading="lazy" />;
  return (
    <span className="m-letter" style={{ width: size, height: size }}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
