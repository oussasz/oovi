import type { CSSProperties } from "react";

type P = { className?: string; style?: CSSProperties; size?: number };
const INK = "#171717";

export function Sparkle({ className, style, size = 32, color = "#FDCB52" }: P & { color?: string }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={`doodle sparkle ${className ?? ""}`} style={style} aria-hidden>
      <path d="M20 2 C21.5 13 27 18.5 38 20 C27 21.5 21.5 27 20 38 C18.5 27 13 21.5 2 20 C13 18.5 18.5 13 20 2 Z" fill={color} />
    </svg>
  );
}

export function MotionTicks({ className, style, size = 56 }: P) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} className={`doodle ${className ?? ""}`} style={style} aria-hidden>
      <g stroke={INK} strokeWidth={6} strokeLinecap="round">
        <line x1="10" y1="34" x2="34" y2="48" />
        <line x1="34" y1="8" x2="44" y2="30" />
      </g>
    </svg>
  );
}

/** Curved hand-drawn arrow. Points to the bottom-left by default. */
export function CurvyArrow({ className, style, size = 70, flip = false }: P & { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 80 60"
      width={size}
      height={(size * 60) / 80}
      className={`doodle ${className ?? ""}`}
      style={{ transform: flip ? "scaleX(-1)" : undefined, ...style }}
      aria-hidden
    >
      <path d="M74 8 C52 6 30 14 18 42" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <path d="M10 30 L17 44 L30 37" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Long flat swoosh arrow pointing right. */
export function SwooshArrow({ className, style, size = 72 }: P) {
  return (
    <svg viewBox="0 0 90 40" width={size} height={(size * 40) / 90} className={`doodle ${className ?? ""}`} style={style} aria-hidden>
      <path d="M4 20 C24 38 54 34 80 14" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <path d="M66 12 L81 13 L76 27" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Loop-de-loop swoosh line. */
export function LoopLine({ className, style, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 60" width={size} height={size / 2} className={`doodle ${className ?? ""}`} style={style} aria-hidden>
      <path
        d="M4 56 C24 40 46 28 70 24 C86 21 96 14 92 8 C88 2 74 6 78 16 C82 26 100 26 116 20"
        stroke={INK}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Hand-drawn underline for a highlighted word. */
export function Underline({ className, style }: P) {
  return (
    <svg viewBox="0 0 120 16" preserveAspectRatio="none" className={`doodle underline ${className ?? ""}`} style={style} aria-hidden>
      <path d="M3 10 C30 5 70 4 117 8" stroke={INK} strokeWidth={3.4} fill="none" strokeLinecap="round" />
    </svg>
  );
}
