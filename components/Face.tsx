"use client";

// Slime avatars in the style of the oovi logo: a soft, slightly lopsided pastel
// pebble with a few ink strokes. It breathes like jelly, squashes and stretches
// from its bottom edge, acts out what the bot is doing (thinking, reading,
// typing on a laptop, sleeping...), squishes when pressed and follows the pointer.
// Everything is SVG + CSS transforms/opacity (Face.module.css), so it stays light.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, type Face as FaceT, type Mood } from "@/lib/faces";
import s from "./Face.module.css";

const INK = "#1d1d1b";
const PAPER = "#ffffff";
const BLUSH = "#ff8a96";
const SPARK = "#FFC83D";
const GREEN = "#34C76F";
const EYE_Y = 51;
const EYE_X = [42.5, 57.5] as const;
/** Below this pixel size, props lose their fine details and features get bolder. */
const SMALL = 32;

type Shape = (typeof SHAPES)[number];

/**
 * Body outline per shape. `top`: head top near x=50 (hair/hats are drawn for top=20).
 * `sides`: body edges at eye height (headphones). `hl`: gloss highlight x, y, angle.
 * `fy`: vertical offset of the face features.
 */
const BODY: Record<Shape, { d: string; top: number; sides: [number, number]; hl: [number, number, number]; fy: number }> = {
  round: { d: "M50 17 C66 15 83 22 87 40 C91 58 86 80 66 88 C54 93 34 92 22 85 C10 77 9 58 14 44 C19 29 34 19 50 17 Z", top: 17, sides: [12, 89], hl: [29, 33, -42], fy: 0 },
  drop: { d: "M44 15 C54 14 66 26 76 38 C86 50 92 64 87 77 C82 89 66 92 50 91 C33 90 15 88 11 74 C7 60 17 44 26 32 C32 24 37 16 44 15 Z", top: 17, sides: [15, 82], hl: [30, 37, -55], fy: 4 },
  mochi: { d: "M46 30 C64 27 84 34 91 50 C97 65 91 84 72 89 C58 92 40 92 26 89 C11 85 5 72 9 58 C13 43 28 32 46 30 Z", top: 30, sides: [9, 93], hl: [25, 45, -28], fy: 6 },
  bean: { d: "M58 14 C72 15 82 28 83 46 C84 66 78 86 60 90 C46 93 28 89 21 76 C14 63 18 46 26 34 C34 22 45 13 58 14 Z", top: 15, sides: [19, 83], hl: [33, 30, -50], fy: -1 },
  pebble: { d: "M62 21 C78 23 90 36 90 55 C90 76 76 90 52 91 C32 92 12 85 10 68 C8 52 20 44 30 37 C40 30 47 20 62 21 Z", top: 24, sides: [13, 90], hl: [31, 41, -38], fy: 4 },
};

/** Mood → where the eyes look (user units). */
const GAZE: Partial<Record<Mood, { x: number; y: number }>> = {
  thinking: { x: 2.5, y: -3 },
  reading: { x: 0, y: 3.2 },
  computer: { x: 0, y: 2.6 },
  sad: { x: 0, y: 1.5 },
  sleeping: { x: 0, y: 1 },
  asking: { x: 0, y: -1 },
};

/** Four-point sparkle, like the stars on the landing page. */
const sparkle = (x: number, y: number, r: number) => `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`;
/** A hand-drawn "z". */
const zee = (x: number, y: number, w: number) => `M${x} ${y} h${w} l${-w} ${w * 1.1} h${w}`;
/** A cursive "e" loop (the landing-page curls), baseline-left at x,y. */
const eLoop = (x: number, y: number, k = 1) =>
  `M${x} ${y} C${x + 3 * k} ${y + 0.4 * k} ${x + 7.6 * k} ${y - 1.4 * k} ${x + 7 * k} ${y - 4.6 * k} C${x + 6.6 * k} ${y - 7.2 * k} ${x + 1.8 * k} ${y - 7 * k} ${x + 1.2 * k} ${y - 3 * k} C${x + 0.6 * k} ${y + 0.8 * k} ${x + 4 * k} ${y + 2.8 * k} ${x + 8.4 * k} ${y + 1.2 * k}`;

function Eyes({ type, mood, hide }: { type: (typeof EYES)[number]; mood: Mood; hide: number[] }) {
  return (
    <g className={s.eyes}>
      {EYE_X.map((x, i) => {
        if (hide.includes(i)) return null;
        const y = EYE_Y;
        if (mood === "happy") return <path key={i} d={`M${x - 4.2} ${y + 2} Q${x} ${y - 5} ${x + 4.2} ${y + 2}`} strokeWidth={3.4} />;
        if (mood === "sleeping") return <path key={i} d={`M${x - 4.2} ${y - 0.5} Q${x} ${y + 4.6} ${x + 4.2} ${y - 0.5}`} strokeWidth={3.2} />;
        switch (type) {
          case "dashes":
            return <path key={i} d={`M${x - 1.3} ${y - 4.3} L${x + 1.3} ${y + 4.3}`} strokeWidth={4.8} />;
          case "wide":
            return (
              <g key={i}>
                <circle cx={x} cy={y} r={5.3} fill={PAPER} strokeWidth={2.4} />
                <circle cx={x + 0.4} cy={y + 0.6} r={2.4} fill={INK} stroke="none" />
              </g>
            );
          case "sleepy":
            return (
              <g key={i}>
                <path d={`M${x - 3.6} ${y} A3.6 3.6 0 0 0 ${x + 3.6} ${y} Z`} fill={INK} stroke="none" />
                <path d={`M${x - 4.6} ${y - 0.2} H${x + 4.6}`} strokeWidth={2.8} />
              </g>
            );
          case "ticks":
            return i === 0 ? <path key={i} d={`M${x + 1.6} ${y - 3} L${x - 1.2} ${y + 3}`} strokeWidth={4.4} /> : <path key={i} d={`M${x - 1.8} ${y - 4.8} Q${x + 1.6} ${y} ${x + 0.2} ${y + 4.6}`} strokeWidth={4.4} />;
          default:
            return (
              <g key={i}>
                <ellipse cx={x} cy={y} rx={3} ry={3.9} fill={INK} stroke="none" />
                <circle cx={x + 1} cy={y - 1.4} r={0.95} fill={PAPER} stroke="none" />
              </g>
            );
        }
      })}
    </g>
  );
}

function Brows({ mood }: { mood: Mood }) {
  switch (mood) {
    case "asking": return <path d="M37 41.5 Q41.5 37.5 46 40.5 M54 40.5 Q58.5 37.5 63 41.5" strokeWidth={2.8} />;
    case "sad": return <path d="M37 43 L45.5 40 M54.5 40 L63 43" strokeWidth={2.8} />;
    case "working": return <path d="M37.5 40 L46 42.5 M54 42.5 L62.5 40" strokeWidth={2.8} />;
    case "thinking": return <path d="M54 41 Q58.5 37 63 40" strokeWidth={2.8} />;
    default: return null;
  }
}

function Mouth({ type, mood }: { type: (typeof MOUTHS)[number]; mood: Mood }) {
  switch (mood) {
    case "happy":
      return (
        <g>
          <path d="M42 59.5 Q50 74 58 59.5 Q50 61.5 42 59.5 Z" fill={INK} strokeWidth={2.2} />
          <path d="M46 64 Q50 61.8 54 64 Q50 67.6 46 64 Z" fill="#FF7F8A" stroke="none" />
        </g>
      );
    case "sad": return <path d="M45 66 Q50 61.5 55 66" />;
    case "asking": return <ellipse cx={50} cy={64} rx={2.3} ry={2.9} fill={INK} stroke="none" />;
    case "thinking": return <path d="M44.5 64 Q47.5 62.6 51 64" />;
    case "working": return <path d="M46 64 H54" />;
    case "sleeping": return <ellipse cx={50} cy={64.5} rx={1.7} ry={2.1} fill={INK} stroke="none" />;
    case "reading":
    case "computer": return <path d="M47 64 Q50 65.6 53 64" />;
    default:
  }
  switch (type) {
    case "grin": return <path d="M43.5 61 Q50 71 56.5 61 Q50 62.5 43.5 61 Z" fill={INK} strokeWidth={2.2} />;
    case "calm": return <path d="M46.5 63.5 Q50 65.3 53.5 63.5" />;
    case "smirk": return <path d="M45.5 64 Q51 66 55 61.5" />;
    case "none": return null;
    case "hook": return <path d="M51 58.5 C53 62 52.5 66 49 66.5 C47.3 66.7 46.3 65.6 46.3 64.4" />;
    default: return <path d="M45 62 Q50 67.5 55 62" />;
  }
}

function Cheeks({ type }: { type: (typeof CHEEKS)[number] }) {
  if (type === "none") return null;
  const blush = type === "freckles" ? 0.22 : 0.45;
  return (
    <g stroke="none">
      {type === "hearts"
        ? [33, 67].map((x) => (
            <path key={x} className={s.cheek} d={`M${x} 63 c-4.2 -2.8 -5.2 -6 -2.6 -7.4 c1.3 -0.7 2.6 0 2.6 1 c0 -1 1.3 -1.7 2.6 -1 c2.6 1.4 1.6 4.6 -2.6 7.4 z`} fill={BLUSH} opacity={0.8} />
          ))
        : [33, 67].map((x) => <ellipse key={x} className={s.cheek} cx={x} cy={59} rx={5.2} ry={3.1} fill={BLUSH} opacity={blush} />)}
      {type === "freckles" && (
        <g fill={INK} opacity={0.5}>
          {[[30.5, 57.5], [34, 60], [35.5, 56.5], [64.5, 56.5], [66, 60], [69.5, 57.5]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} />
          ))}
        </g>
      )}
    </g>
  );
}

/** Hair, drawn for a head top at (50, 20). */
function Hair({ type, color }: { type: (typeof HAIR)[number]; color: string }) {
  switch (type) {
    case "curls": return <path d={`${eLoop(40.5, 17, 1.15)} ${eLoop(49.5, 17.5, 1.15)}`} strokeWidth={2.6} />;
    case "loop": return <path d="M48 21 C47 15 49 9 54 7.5 C58.5 6.5 59.5 11 56.5 12.6 C53 14.4 49.5 11.8 50.6 7.8 C51.4 4.8 54.6 3.6 57.6 4.6" strokeWidth={2.6} />;
    case "spikes": return <path d="M41.5 16 L38 9.5 M50 14 V6.5 M58.5 16 L62 9.5" strokeWidth={3.4} />;
    case "fringe": return <path d="M31 31 Q40 19 55 21 M47 21.5 Q60 17 69 27" strokeWidth={2.8} />;
    case "waves": return <path d="M37 18.5 q3.25 -5 6.5 0 t6.5 0 t6.5 0 t6.5 0" strokeWidth={2.6} />;
    case "tuft": return <path d="M50 20.5 Q48 13 54 9 M49.5 20.5 Q45 15 40 15" strokeWidth={2.8} />;
    case "bun":
      return (
        <g>
          <circle cx={50} cy={12} r={7} fill={color} stroke="none" />
          <path d="M44.5 19 Q50 16 55.5 19" strokeWidth={2.4} />
        </g>
      );
    case "cloud": {
      const d = "M14 46 q-4 -9 3 -15 q-1 -11 11 -14 q4 -10 16 -7 q8 -7 18 0 q12 -2 15 8 q10 4 8 15 q5 6 2 13 Z";
      return (
        <g stroke="none">
          <path d={d} fill={color} />
          <path d={d} fill={INK} opacity={0.08} />
        </g>
      );
    }
    default: return null;
  }
}

/** Things drawn behind the body (so the body hides their base). */
function TopBehind({ type, color }: { type: (typeof TOPS)[number]; color: string }) {
  if (type === "catears")
    return (
      <g stroke="none">
        <path d="M22 42 C21 30 22 18 25 12 C32 15 39 20 44 26 Z" fill={color} />
        <path d="M78 42 C79 30 78 18 75 12 C68 15 61 20 56 26 Z" fill={color} />
        <path d="M27 30 L27.5 19 L36 25 Z" fill="#FFB3C0" />
        <path d="M73 30 L72.5 19 L64 25 Z" fill="#FFB3C0" />
      </g>
    );
  if (type === "horns")
    return (
      <g strokeWidth={2.4}>
        <path d="M32 32 Q22 16 29 5 Q34 17 44 24 Z" fill="#FF8F7A" />
        <path d="M68 32 Q78 16 71 5 Q66 17 56 24 Z" fill="#FF8F7A" />
      </g>
    );
  return null;
}

function Top({ type }: { type: (typeof TOPS)[number] }) {
  switch (type) {
    case "hat":
      return (
        <g strokeWidth={2.6}>
          <path d="M31 28 L34 10 Q50 5 66 10 L69 28 Z" fill={INK} />
          <path d="M33.5 21 Q50 17 66.5 21" stroke="#FF9F86" strokeWidth={3} />
          <path d="M14 30 Q50 19 86 30 Q50 37 14 30 Z" fill={INK} />
        </g>
      );
    case "beret":
      return (
        <g strokeWidth={2.6}>
          <ellipse cx={46} cy={21} rx={24} ry={8.5} fill="#FF9F86" transform="rotate(-10 46 21)" />
          <path d="M43 12.5 l-1 -5" />
        </g>
      );
    case "crown":
      return (
        <g strokeWidth={2.4}>
          <path d="M34 23 L36 8 L43.5 15 L50 5 L56.5 15 L64 8 L66 23 Z" fill="#FDDA80" />
          <circle cx={50} cy={17} r={1.9} fill="#FF9F86" stroke="none" />
        </g>
      );
    case "bow":
      return (
        <g transform="translate(64 19)" strokeWidth={2.4}>
          <path d="M0 0 C-8 -9 -13 -2 -10 3 C-8 7 -3 3 0 0 Z M0 0 C8 -9 13 -2 10 3 C8 7 3 3 0 0 Z" fill="#FF9BB0" />
          <circle r={2.6} fill="#FF9BB0" />
        </g>
      );
    case "flower":
      return (
        <g transform="translate(64 19)" strokeWidth={1.6}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4.4} cy={Math.sin((a * Math.PI) / 180) * 4.4} r={3.5} fill={PAPER} />
          ))}
          <circle r={2.8} fill="#FDDA80" />
        </g>
      );
    case "cap":
      return (
        <g strokeWidth={2.4}>
          <path d="M28 27 Q29 8 51 8 Q72 8 73 27 Z" fill="#9FB4F7" />
          <path d="M50 26 Q72 19 89 28 Q72 31 50 28 Z" fill="#9FB4F7" />
          <circle cx={51} cy={9} r={1.8} fill={INK} stroke="none" />
        </g>
      );
    case "halo": return <ellipse cx={50} cy={7} rx={16} ry={4.2} stroke="#E8B83A" strokeWidth={3} />;
    case "sprout":
      return (
        <g strokeWidth={2.4}>
          <path d="M50 21 Q49 13 52 8" />
          <path d="M52 9 Q60 2 65 8 Q58 12 52 9 Z" fill="#8FD19E" />
          <path d="M51 13 Q43 7 38 12 Q45 16 51 13 Z" fill="#8FD19E" />
        </g>
      );
    default: return null;
  }
}

function Wear({ type }: { type: (typeof WEAR)[number] }) {
  switch (type) {
    case "glasses":
      return (
        <g strokeWidth={2.3}>
          <circle cx={42.5} cy={51} r={6.3} fill={PAPER} fillOpacity={0.25} />
          <circle cx={57.5} cy={51} r={6.3} fill={PAPER} fillOpacity={0.25} />
          <path d="M48.6 50 Q50 48.6 51.4 50 M36.2 50 L29 47.5 M63.8 50 L71 47.5" />
        </g>
      );
    case "shades":
      return (
        <g strokeWidth={2.6}>
          <circle cx={41.8} cy={51} r={6.8} fill={INK} />
          <circle cx={58.2} cy={51} r={6.8} fill={INK} />
          <path d="M48 50 Q50 48.5 52 50 M35 49.5 L28 47 M65 49.5 L72 47" />
          <path d="M38 48.5 q1.5 -2 3.5 -2.2 M54.4 48.5 q1.5 -2 3.5 -2.2" stroke={PAPER} strokeWidth={1.5} opacity={0.65} />
        </g>
      );
    case "monocle":
      return (
        <g strokeWidth={2.2}>
          <circle cx={57.5} cy={51} r={6.8} fill={PAPER} fillOpacity={0.25} />
          <path d="M63.5 54.5 Q68 64 63 76" strokeWidth={1.6} />
        </g>
      );
    case "mustache": return <path d="M50 58 C47 55.5 42 55.5 40.5 60 C43 58.8 46 60.6 50 59.6 C54 60.6 57 58.8 59.5 60 C58 55.5 53 55.5 50 58 Z" fill={INK} strokeWidth={1.2} />;
    case "patch":
      return (
        <g strokeWidth={2.4}>
          <path d="M53 46.5 L33 30 M63.5 54 L82 59" />
          <circle cx={57.5} cy={51} r={6.3} fill={INK} />
        </g>
      );
    case "star": return <path d={sparkle(69, 62, 6)} fill={SPARK} stroke="none" />;
    default: return null;
  }
}

/** A small open book held in front (web search, reading pages). */
function Book({ color, detailed }: { color: string; detailed: boolean }) {
  const page = (side: 1 | -1) => `M50 72 C${50 + 6 * side} 69 ${50 + 14 * side} 69 ${50 + 21 * side} 71 L${50 + 21 * side} 88 C${50 + 14 * side} 86 ${50 + 6 * side} 86 50 89 Z`;
  return (
    <g strokeWidth={detailed ? 2.2 : 3.4}>
      <path d="M50 74 C43 71 34 71 27 73 L27 90.5 C35 88.5 43 88.5 50 91.5 C57 88.5 65 88.5 73 90.5 L73 73 C66 71 57 71 50 74 Z" fill={color} />
      <path d={page(-1)} fill={PAPER} />
      <path d={page(1)} fill={PAPER} />
      {detailed && (
        <>
          <path d="M33.5 76 Q39.5 74.8 46 76 M33.5 80 Q39.5 78.8 46 80 M33.5 84 Q38.5 83 43 84 M54 76 Q60.5 74.8 66.5 76 M54 80 Q60.5 78.8 66.5 80 M57 84 Q61.5 83 66.5 84" strokeWidth={1.3} opacity={0.35} />
          <path className={s.flip} d={page(1)} fill={PAPER} />
        </>
      )}
      <path d="M50 72 V89" />
    </g>
  );
}

/** A little paw (body colored). */
const Paw = ({ x, y, r, color, className }: { x: number; y: number; r: number; color: string; className?: string }) => (
  <g className={className}>
    <ellipse cx={x} cy={y} rx={5.4} ry={4.2} transform={`rotate(${r} ${x} ${y})`} fill={color} strokeWidth={2.2} />
  </g>
);

export type FaceProps = { face: FaceT | Record<string, unknown>; mood?: Mood; size?: number; title?: string; className?: string; interactive?: boolean };

export default function Face({ face: raw, mood = "idle", size = 40, title, className, interactive = false }: FaceProps) {
  const face = normalizeFace(raw);
  const ref = useRef<SVGSVGElement>(null);
  const uid = `f${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [poke, setPoke] = useState<"" | "down" | "up">("");

  // Big faces follow the pointer (one rAF per move, no layout work).
  useEffect(() => {
    if (!interactive) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260);
        setLook({ x: (dx / d) * 4 * k, y: (dy / d) * 3 * k });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [interactive]);

  useEffect(() => {
    if (poke !== "up") return;
    const t = setTimeout(() => setPoke(""), 850);
    return () => clearTimeout(t);
  }, [poke]);

  const release = () => setPoke((p) => (p === "down" ? "up" : p));

  const small = size < SMALL;
  const detailed = !small;
  const color = FACE_COLORS[face.color] ?? FACE_COLORS[0];
  const shape = SHAPES[face.shape] ?? "round";
  const body = BODY[shape];
  const dy = body.top - 20;
  const hair = HAIR[face.hair] ?? "none";
  const top = TOPS[face.top] ?? "none";
  const wear = WEAR[face.wear] ?? "none";
  const coversHair = top === "hat" || top === "beret" || top === "cap";
  const hideEyes = wear === "shades" ? [0, 1] : wear === "patch" ? [1] : [];
  const gaze = GAZE[mood] ?? { x: 0, y: 0 };
  const cy = 55 + body.fy;
  const featT = `translate(0 ${body.fy})${small ? ` translate(50 ${cy}) scale(1.22) translate(-50 ${-cy})` : ""}`;
  const accent = face.color === 2 || face.color === 4 || face.color === 5 ? FACE_COLORS[0] : FACE_COLORS[2];
  const [l, r] = body.sides;
  const bandY = (body.top - 4 - 0.25 * 58) / 0.75;

  // Overlays that float around the body, per mood.
  let extras: ReactNode = null;
  switch (mood) {
    case "online":
      extras = (
        <g>
          <circle className={s.ping} cx={84} cy={84} r={small ? 10.5 : 7} fill={GREEN} />
          <circle cx={84} cy={84} r={small ? 10.5 : 7} fill={GREEN} stroke={PAPER} strokeWidth={small ? 4 : 3} />
        </g>
      );
      break;
    case "thinking":
      extras = (
        <g className={s.bubble} strokeWidth={small ? 3.2 : 2.2}>
          {detailed && <circle cx={70} cy={27} r={1.5} fill={PAPER} />}
          {detailed && <circle cx={75} cy={20.5} r={2.3} fill={PAPER} />}
          <ellipse cx={85} cy={11} rx={11.5} ry={8.5} fill={PAPER} />
          {[80.5, 85, 89.5].map((x, i) => (
            <circle key={x} className={s[`dot${i}`]} cx={x} cy={11} r={small ? 2.2 : 1.7} fill={INK} stroke="none" />
          ))}
        </g>
      );
      break;
    case "asking":
      extras = (
        <g className={s.qmark} strokeWidth={small ? 4.6 : 3.4}>
          <path d="M79.5 11.5 C79.5 6 88.5 5 88.5 11 C88.5 15 84 15.5 84 20" />
          <circle cx={84} cy={25.5} r={small ? 2.6 : 2} fill={INK} stroke="none" />
        </g>
      );
      break;
    case "working":
      extras = <path className={s.ticks} d="M17 22 L9 16.5 M24 14.5 L20.5 6.5" strokeWidth={small ? 5 : 3.8} />;
      break;
    case "happy":
      extras = (
        <g stroke="none" fill={SPARK}>
          <path className={s.twinkle} d={sparkle(14, 24, small ? 8 : 6.5)} />
          <path className={`${s.twinkle} ${s.late}`} d={sparkle(87, 20, small ? 6.5 : 5)} />
        </g>
      );
      break;
    case "sad":
      extras = detailed ? <path className={s.drip} d="M78 29 C80.5 33 81.5 35 81.5 36.5 A3.5 3.5 0 0 1 74.5 36.5 C74.5 35 75.5 33 78 29 Z" fill="#B7DAFF" strokeWidth={1.8} /> : null;
      break;
    case "sleeping":
      extras = (
        <g strokeWidth={small ? 3.8 : 2.6}>
          <path className={s.z} d={zee(67, 25, 5)} />
          <path className={`${s.z} ${s.z2}`} d={zee(76, 14, 6.5)} />
          <path className={`${s.z} ${s.z3}`} d={zee(86, 2, 8)} />
        </g>
      );
      break;
    default:
  }

  const cls = ["face", s.root, interactive ? s.interactive : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cls}
      data-mood={mood}
      data-big={size >= 48 || undefined}
      data-small={small || undefined}
      data-poke={poke || undefined}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      onPointerDown={() => setPoke("down")}
      onPointerUp={release}
      onPointerLeave={release}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`${uid}s`}>
          <stop offset="0" stopColor={INK} stopOpacity={0.2} />
          <stop offset="1" stopColor={INK} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}g`} cx="0.34" cy="0.26" r="0.85">
          <stop offset="0" stopColor={PAPER} stopOpacity={0.3} />
          <stop offset="0.45" stopColor={PAPER} stopOpacity={0} />
          <stop offset="0.78" stopColor={INK} stopOpacity={0} />
          <stop offset="1" stopColor={INK} stopOpacity={0.09} />
        </radialGradient>
      </defs>
      <ellipse className={s.shadow} cx={50} cy={92.5} rx={32} ry={5} fill={`url(#${uid}s)`} />
      <g fill="none" stroke={INK} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
        <g className={s.body}>
          <g transform={`translate(0 ${dy})`}>
            <TopBehind type={top} color={color} />
            {hair === "cloud" && !coversHair && <Hair type="cloud" color={color} />}
            {hair === "bun" && !coversHair && <Hair type="bun" color={color} />}
          </g>
          <path d={body.d} fill={color} stroke="none" />
          <path d={body.d} fill={`url(#${uid}g)`} stroke="none" />
          <ellipse cx={body.hl[0]} cy={body.hl[1]} rx={6.2} ry={2.8} fill={PAPER} opacity={0.45} stroke="none" transform={`rotate(${body.hl[2]} ${body.hl[0]} ${body.hl[1]})`} />
          {detailed && <circle cx={body.hl[0] - 4} cy={body.hl[1] + 8} r={1.4} fill={PAPER} opacity={0.4} stroke="none" />}

          <g transform={featT}>
            <g className={s.feat} style={{ transform: `translate(${gaze.x + look.x}px, ${gaze.y + look.y}px)` }}>
              <Cheeks type={CHEEKS[face.cheeks] ?? "none"} />
              <Eyes type={EYES[face.eyes] ?? "dashes"} mood={mood} hide={hideEyes} />
              <Brows mood={mood} />
              {NOSES[face.nose] === "hook" && <path d="M51.5 54 q-4 5 -0.5 6.5" strokeWidth={2.4} />}
              {NOSES[face.nose] === "line" && <path d="M50 54.5 l-2 5 h3.2" strokeWidth={2.4} />}
              <Mouth type={MOUTHS[face.mouth] ?? "smile"} mood={mood} />
              <Wear type={wear} />
            </g>
          </g>

          <g transform={`translate(0 ${dy})`}>
            {!coversHair && hair !== "cloud" && hair !== "bun" && <Hair type={hair} color={color} />}
            <Top type={top} />
          </g>
          {top === "headphones" && (
            <g strokeWidth={2.6}>
              <path d={`M${l + 2} 54 C${l + 2} ${bandY} ${r - 2} ${bandY} ${r - 2} 54`} strokeWidth={3.2} />
              <rect x={l - 5} y={46} width={10} height={18} rx={5} fill={PAPER} />
              <rect x={r - 5} y={46} width={10} height={18} rx={5} fill={PAPER} />
            </g>
          )}

          {mood === "reading" && (
            <>
              <Book color={accent} detailed={detailed} />
              {detailed && <Paw x={27.5} y={83} r={25} color={color} />}
              {detailed && <Paw x={72.5} y={83} r={-25} color={color} />}
            </>
          )}
        </g>

        {mood === "computer" && (
          <g>
            {detailed && <Paw x={26} y={86} r={20} color={color} className={s.tapL} />}
            {detailed && <Paw x={74} y={86} r={-20} color={color} className={s.tapR} />}
            <rect x={29} y={66.5} width={42} height={23} rx={3.5} fill="#EEF0F6" strokeWidth={detailed ? 2.4 : 3.6} />
            {detailed && (
              <g stroke="none">
                <circle cx={50} cy={75.6} r={2} fill={FACE_COLORS[0]} />
                <circle cx={47.8} cy={79} r={2} fill={FACE_COLORS[1]} />
                <circle cx={52.2} cy={79} r={2} fill={FACE_COLORS[2]} />
              </g>
            )}
            <rect x={21} y={88.5} width={58} height={4.5} rx={2.25} fill="#D7DBE6" strokeWidth={detailed ? 2.2 : 3.4} />
          </g>
        )}
        {extras}
      </g>
    </svg>
  );
}

/** Up to three slimes huddled together, like the oovi logo. */
export function FaceStack({ faces, size = 40, moods }: { faces: (FaceT | Record<string, unknown>)[]; size?: number; moods?: Mood[] }) {
  const shown = faces.slice(0, 3);
  const box = { position: "relative" as const, display: "inline-block", flex: "none", width: size, height: size };
  if (shown.length <= 1) return shown[0] ? <Face face={shown[0]} size={size} mood={moods?.[0]} /> : <span className="face-stack" style={box} />;
  const s2 = Math.round(size * (shown.length === 2 ? 0.7 : 0.66));
  // Logo layout: one at the back on top, two in front at the bottom.
  const spots: [number, number, number][] =
    shown.length === 2
      ? [[0, 0, 1], [size - s2, size - s2, 2]]
      : [[(size - s2) / 2 + size * 0.07, 0, 1], [0, size - s2 - size * 0.03, 2], [size - s2, size - s2, 3]];
  return (
    <span className="face-stack" style={box}>
      {shown.map((f, i) => (
        <span key={i} style={{ position: "absolute", left: spots[i]?.[0], top: spots[i]?.[1], zIndex: spots[i]?.[2] }}>
          <Face face={f} size={s2} mood={moods?.[i]} />
        </span>
      ))}
    </span>
  );
}
