"use client";

// iOS-style building blocks: bars that blur and collapse their large title on scroll, the tab bar, inset grouped
// lists, action sheets, sheets, swipe actions, pull to refresh, toasts. Sizes are in rem (they follow the phone's
// text size on iPhone, see m.css) and every touch target is at least 44 pt.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import FaceView, { FaceStack } from "@/components/Face";
import type { Mood } from "@/lib/faces";
import { isUnread } from "../_lib/core";
import { tap } from "../_lib/haptics";
import { Icon, type IconName } from "./Icon";
import { canGoBack, useM } from "./MobileApp";

// ---------- scrolling ----------

/** True once the page scrolled past `px` (the large title is then shown small in the bar). */
export function useScrolledPast(px: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPast(window.scrollY > px));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
    };
  }, [px]);
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

export function LargeTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-large">{children}</h1>;
}

export function TabBar() {
  const { t, chats, seen, archived } = useM();
  const path = usePathname() ?? "/m";
  const unread = Object.values(chats).filter(({ chat }) => !chat.routine && !archived.includes(chat.id) && isUnread(chat, seen[chat.id])).length;
  const tabs: { href: string; label: string; icon: IconName; on: boolean; badge?: number }[] = [
    { href: "/m", label: t("tab.chats"), icon: "chats", on: path === "/m" || path.startsWith("/m/c/"), badge: unread },
    { href: "/m/bots", label: t("tab.bots"), icon: "bots", on: path.startsWith("/m/bots") },
    { href: "/m/settings", label: t("tab.settings"), icon: "settings", on: path.startsWith("/m/settings") },
  ];
  return (
    <nav className="m-tabs" aria-label="oovi">
      {tabs.map((tb) => (
        <Link key={tb.href} href={tb.href} className={`m-tab${tb.on ? " is-on" : ""}`} aria-current={tb.on ? "page" : undefined} onClick={() => tap()}>
          <span className="m-tab__icon">
            <Icon name={tb.icon} size={27} stroke={tb.on ? 2.1 : 1.8} />
            {tb.badge ? <span className="m-badge" aria-label={`${tb.badge}`}>{tb.badge > 99 ? "99+" : tb.badge}</span> : null}
          </span>
          <span className="m-tab__label">{tb.label}</span>
        </Link>
      ))}
    </nav>
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

export function IconTile({ name, color }: { name: IconName; color: string }) {
  return (
    <span className="m-tile" style={{ background: color }}>
      <Icon name={name} size={19} stroke={2.1} />
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

export type SheetAction = { label: string; onPress: () => void; destructive?: boolean; bold?: boolean; checked?: boolean };

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
              className={`m-asheet__btn${a.destructive ? " is-danger" : ""}${a.bold ? " is-bold" : ""}`}
              aria-pressed={a.checked === undefined ? undefined : a.checked}
              onClick={() => {
                tap(a.destructive ? "warning" : "light");
                onClose();
                a.onPress();
              }}
            >
              <span>{a.label}</span>
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
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
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
          <button type="button" className="m-sheet__done" onClick={onClose}>
            {t("common.done")}
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
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  useEffect(() => {
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
  }, [onRefresh, busy]);
  const h = busy ? 52 : pull;
  return (
    <div className="m-ptr" style={{ height: h }} aria-hidden={!busy}>
      {(busy || pull > 8) && <Spinner progress={busy ? undefined : Math.min(1, pull / 64)} />}
    </div>
  );
}

export function Spinner({ progress, size = 22 }: { progress?: number; size?: number }) {
  const n = 8;
  return (
    <span className={`m-spin${progress === undefined ? " is-busy" : ""}`} style={{ width: size, height: size }} role="progressbar" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ transform: `rotate(${(360 / n) * i}deg)`, opacity: progress === undefined ? undefined : i / n < progress ? 0.15 + (0.85 * (i + 1)) / n : 0 }} />
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

export function Empty({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="m-empty">
      {icon && <div className="m-empty__icon">{icon}</div>}
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
