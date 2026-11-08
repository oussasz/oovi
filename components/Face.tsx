"use client";

// Slime avatars: a soft, glossy pastel blob with a few ink strokes.
// It breathes like jelly, squashes and stretches with its mood, squishes when
// you press it (cheeks puff out), and big faces follow your pointer.
// Everything is SVG + CSS transforms (see globals.css), so it stays light.

import { useEffect, useRef, useState } from "react";
import { CHEEKS, EYES, FACE_COLORS, HAIR, MOUTHS, NOSES, SHAPES, TOPS, WEAR, normalizeFace, type Face as FaceT, type Mood } from "@/lib/faces";

const INK = "#1d1d1b";
const PAPER = "#ffffff";
const PINK = "#ff7f8a";
const EYE_Y = 53;
const EYE_X = [39, 61] as const;

/** Body outline per shape, and where the top of the head is (hair/hats sit there). */
const BODY: Record<(typeof SHAPES)[number], { d: string; top: number }> = {
  round: { d: "M50 20 C74 20 89 37 89 58 C89 79 75 90 50 90 C25 90 11 79 11 58 C11 37 26 20 50 20 Z", top: 20 },
  drop: { d: "M50 14 C58 24 87 38 88 60 C89 80 75 90 50 90 C25 90 11 80 12 60 C13 38 42 24 50 14 Z", top: 16 },
  mochi: { d: "M50 26 C79 26 94 43 93 64 C92 82 77 90 50 90 C23 90 8 82 7 64 C6 43 21 26 50 26 Z", top: 26 },
  bean: { d: "M50 17 C70 17 82 33 82 56 C82 80 70 91 50 91 C30 91 18 80 18 56 C18 33 30 17 50 17 Z", top: 18 },
};

function star(cx: number, cy: number, R: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push(`${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

function Eyes({ type, mood, hide }: { type: (typeof EYES)[number]; mood: Mood; hide: number[] }) {
  const look = mood === "thinking" ? { dx: 2, dy: -3 } : mood === "working" ? { dx: 0, dy: 1.5 } : { dx: 0, dy: 0 };
  return (
    <g className="eyes">
      {EYE_X.map((x, i) => {
        if (hide.includes(i)) return null;
        const y = EYE_Y;
        if (mood === "happy") return <path key={i} d={`M${x - 4.5} ${y + 1.5} q4.5 -6 9 0`} />;
        if (type === "dashes") return <path key={i} d={`M${x - 0.8 + look.dx} ${y - 4 + look.dy} L${x + 0.8 + look.dx} ${y + 4 + look.dy}`} strokeWidth={3.8} />;
        if (type === "wide")
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={5.2} fill={PAPER} strokeWidth={2.4} />
              <circle cx={x + look.dx * 0.8} cy={y + look.dy * 0.8} r={2.1} fill={INK} stroke="none" />
            </g>
          );
        if (type === "sleepy" && mood === "idle") return <path key={i} d={`M${x - 4.5} ${y - 0.5} q4.5 3.5 9 0`} />;
        return (
          <g key={i}>
            <circle cx={x + look.dx} cy={y + look.dy} r={2.9} fill={INK} stroke="none" />
            <circle cx={x + look.dx + 0.9} cy={y + look.dy - 1} r={0.9} fill={PAPER} stroke="none" />
          </g>
        );
      })}
    </g>
  );
}

function Brows({ mood }: { mood: Mood }) {
  if (mood === "asking") return <path d="M33 44 q5 -4.5 10 0 M57 44 q5 -4.5 10 0" />;
  if (mood === "sad") return <path d="M33 46 L43 42.5 M57 42.5 L67 46" />;
  if (mood === "working") return <path d="M33 42.5 L43 45.5 M57 45.5 L67 42.5" />;
  return null;
}

function Mouth({ type, mood }: { type: (typeof MOUTHS)[number]; mood: Mood }) {
  switch (mood) {
    case "thinking": return <ellipse cx={54} cy={74} rx={2.4} ry={2.8} />;
    case "working": return <path d="M44 74 h12" />;
    case "asking": return <ellipse cx={50} cy={74} rx={3.4} ry={4.4} />;
    case "happy": return <path d="M39 69 q11 15 22 0 z" fill={PAPER} />;
    case "sad": return <path d="M42 77 q8 -7 16 0" />;
    default:
  }
  if (type === "grin") return <path d="M40 70 q10 13 20 0 z" fill={PAPER} />;
  if (type === "calm") return <path d="M44 74 q6 2.5 12 0" />;
  if (type === "smirk") return <path d="M43 74 q8 3 14 -4" />;
  return <path d="M41 72 q9 8 18 0" />;
}

function Cheeks({ type }: { type: (typeof CHEEKS)[number] }) {
  if (type === "blush")
    return (
      <g stroke="none">
        <ellipse className="cheek" cx={28} cy={63} rx={6.5} ry={3.8} fill={PINK} opacity={0.42} />
        <ellipse className="cheek" cx={72} cy={63} rx={6.5} ry={3.8} fill={PINK} opacity={0.42} />
      </g>
    );
  if (type === "freckles")
    return (
      <g stroke="none">
        <ellipse className="cheek" cx={28} cy={63} rx={6} ry={3.4} fill={PINK} opacity={0.22} />
        <ellipse className="cheek" cx={72} cy={63} rx={6} ry={3.4} fill={PINK} opacity={0.22} />
        <g fill={INK} opacity={0.5}>
          {[[25, 61], [29, 64], [31, 60], [69, 60], [71, 64], [75, 61]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={0.95} />
          ))}
        </g>
      </g>
    );
  if (type === "hearts")
    return (
      <g stroke="none">
        {[28, 72].map((x) => (
          <path key={x} className="cheek" d={`M${x} 67 c-4.5 -3 -5.5 -6.5 -2.8 -8 c1.4 -0.8 2.8 0 2.8 1.1 c0 -1.1 1.4 -1.9 2.8 -1.1 c2.7 1.5 1.7 5 -2.8 8 z`} fill={PINK} opacity={0.75} />
        ))}
      </g>
    );
  return null;
}

function Hair({ type, color }: { type: (typeof HAIR)[number]; color: string }) {
  switch (type) {
    case "curls":
      return (
        <g>
          {[[34, 24], [42, 19], [51, 17], [60, 19], [67, 24]].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r={4.4} fill={color} />
          ))}
        </g>
      );
    case "spikes": return <path d="M43 21 l2 -11 M50 20 l3 -12 M57 21 l4 -10" />;
    case "fringe": return <path d="M26 38 Q36 18 60 20 M44 22 Q66 18 74 32" />;
    case "waves": return <path d="M33 22 q4 -7 8 0 t8 0 t8 0 t8 0" />;
    case "tuft": return <path d="M40 21 l3 -7 l3 7 l3 -7 l3 7 l3 -7 l3 7" />;
    case "bun":
      return (
        <g>
          <circle cx={50} cy={12} r={6.5} fill={color} />
          <path d="M43 21 q7 -4 14 0" />
        </g>
      );
    case "cloud":
      return <path d="M14 46 q-4 -9 3 -15 q-1 -11 11 -14 q4 -10 16 -7 q8 -7 18 0 q12 -2 15 8 q10 4 8 15 q5 6 2 13" />;
    default: return null;
  }
}

/** Things drawn behind the body (so the body hides their base). */
function TopBehind({ type, color }: { type: (typeof TOPS)[number]; color: string }) {
  if (type === "catears")
    return (
      <g>
        <path d="M21 40 L23 12 L43 25 Z" fill={color} />
        <path d="M79 40 L77 12 L57 25 Z" fill={color} />
        <path d="M26 30 L27 18 L36 24 Z" fill="#FFB3C0" stroke="none" />
        <path d="M74 30 L73 18 L64 24 Z" fill="#FFB3C0" stroke="none" />
      </g>
    );
  if (type === "horns")
    return (
      <g>
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
        <g>
          <path d="M30 28 L33 10 Q50 5 67 10 L70 28 Z" fill={PAPER} />
          <path d="M12 30 Q50 18 88 30 Q50 38 12 30 Z" fill={PAPER} />
        </g>
      );
    case "beret":
      return (
        <g>
          <ellipse cx={46} cy={22} rx={25} ry={9} fill={PAPER} transform="rotate(-10 46 22)" />
          <path d="M43 13 l-1 -5" />
        </g>
      );
    case "crown":
      return (
        <g>
          <path d="M33 23 L35 7 L43 15 L50 4 L57 15 L65 7 L67 23 Z" fill="#FDDA80" />
          <circle cx={50} cy={17} r={2} fill="#FF9F86" stroke="none" />
        </g>
      );
    case "bow":
      return (
        <g transform="translate(64 19)">
          <path d="M0 0 C-8 -9 -13 -2 -10 3 C-8 7 -3 3 0 0 Z M0 0 C8 -9 13 -2 10 3 C8 7 3 3 0 0 Z" fill="#FF9BB0" />
          <circle r={2.6} fill="#FF9BB0" />
        </g>
      );
    case "flower":
      return (
        <g transform="translate(66 19)" strokeWidth={1.6}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4.4} cy={Math.sin((a * Math.PI) / 180) * 4.4} r={3.5} fill={PAPER} />
          ))}
          <circle r={2.8} fill="#FDDA80" />
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M27 27 Q28 8 51 8 Q73 8 74 27 Z" fill="#9FB4F7" />
          <path d="M50 26 Q72 19 89 28 Q72 31 50 28 Z" fill="#9FB4F7" />
          <circle cx={51} cy={9} r={1.8} fill={INK} stroke="none" />
        </g>
      );
    case "halo": return <ellipse cx={50} cy={7} rx={17} ry={4.5} stroke="#E8B83A" strokeWidth={3} />;
    case "sprout":
      return (
        <g>
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
      return <path d="M31.5 51 l-8 -3 M68.5 51 l8 -3 M46.5 52 q3.5 -3 7 0 M46.5 53 a7.5 7.5 0 1 1 -15 0 a7.5 7.5 0 1 1 15 0 M68.5 53 a7.5 7.5 0 1 1 -15 0 a7.5 7.5 0 1 1 15 0" />;
    case "shades":
      return (
        <g>
          <ellipse cx={39} cy={53} rx={8.5} ry={6.5} fill={INK} />
          <ellipse cx={61} cy={53} rx={8.5} ry={6.5} fill={INK} />
          <path d="M47.5 52 h5 M30.5 51 l-7 -3 M69.5 51 l7 -3" />
          <path d="M34 50 l3 -2 M56 50 l3 -2" stroke={PAPER} strokeWidth={1.6} opacity={0.6} />
        </g>
      );
    case "monocle":
      return (
        <g>
          <circle cx={61} cy={53} r={7.5} fill="rgba(255,255,255,0.25)" />
          <path d="M68 57 Q73 68 66 81" strokeWidth={1.8} />
        </g>
      );
    case "mustache": return <path d="M41 67.5 q4.5 4 9 0 q4.5 4 9 0" />;
    case "patch":
      return (
        <g>
          <path d="M55 48 L30 31 M67 56 L85 61" />
          <circle cx={61} cy={53} r={7} fill={INK} />
        </g>
      );
    case "star": return <path d={star(73, 66, 5, 2.2)} fill="#FDDA80" strokeWidth={1.6} />;
    default: return null;
  }
}

export type FaceProps = { face: FaceT | Record<string, unknown>; mood?: Mood; size?: number; title?: string; className?: string; interactive?: boolean };

export default function Face({ face: raw, mood = "idle", size = 40, title, className, interactive = false }: FaceProps) {
  const face = normalizeFace(raw);
  const ref = useRef<SVGSVGElement>(null);
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

  const color = FACE_COLORS[face.color] ?? FACE_COLORS[0];
  const shape = SHAPES[face.shape] ?? "round";
  const body = BODY[shape];
  const dy = body.top - 20;
  const hair = HAIR[face.hair] ?? "none";
  const top = TOPS[face.top] ?? "none";
  const wear = WEAR[face.wear] ?? "none";
  const coversHair = top === "hat" || top === "beret" || top === "cap";
  const hideEyes = wear === "shades" ? [0, 1] : wear === "patch" ? [1] : [];

  const cls = ["face", `mood-${mood}`, size >= 48 ? "big" : "", interactive ? "interactive" : "", poke ? `poke-${poke}` : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cls}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      onPointerDown={() => setPoke("down")}
      onPointerUp={release}
      onPointerLeave={release}
    >
      {title && <title>{title}</title>}
      <ellipse className="shadow" cx={50} cy={94} rx={27} ry={3.2} fill="#000" opacity={0.1} />
      <g className="body" fill="none" stroke={INK} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
        <g transform={`translate(0 ${dy})`}>
          <TopBehind type={top} color={color} />
          {hair === "cloud" && !coversHair && <Hair type="cloud" color={color} />}
        </g>
        <path d={body.d} fill={color} stroke="none" />
        <ellipse cx={33} cy={body.top + 15} rx={8} ry={4.4} fill={PAPER} opacity={0.45} stroke="none" transform={`rotate(-28 33 ${body.top + 15})`} />
        <circle cx={24} cy={body.top + 25} r={1.8} fill={PAPER} opacity={0.5} stroke="none" />

        <g className="feat" style={{ transform: `translate(${look.x}px, ${look.y}px)` }}>
          <Cheeks type={CHEEKS[face.cheeks] ?? "none"} />
          <Eyes type={EYES[face.eyes] ?? "dots"} mood={mood} hide={hideEyes} />
          <Brows mood={mood} />
          {NOSES[face.nose] === "hook" && <path d="M51 55 q-5 8 0 10" />}
          {NOSES[face.nose] === "line" && <path d="M50 56 l-2.5 7 h4" />}
          <Mouth type={MOUTHS[face.mouth] ?? "smile"} mood={mood} />
          <Wear type={wear} />
        </g>

        <g transform={`translate(0 ${dy})`}>
          {!coversHair && hair !== "cloud" && <Hair type={hair} color={color} />}
          <Top type={top} />
        </g>
        {top === "headphones" && (
          <g>
            <path d={`M15 56 Q13 ${8 + dy} 50 ${8 + dy} Q87 ${8 + dy} 85 56`} />
            <rect x={6} y={47} width={11} height={20} rx={5} fill={PAPER} />
            <rect x={83} y={47} width={11} height={20} rx={5} fill={PAPER} />
          </g>
        )}
      </g>
    </svg>
  );
}

/** Up to three slimes huddled together, like the oovi logo. */
export function FaceStack({ faces, size = 40, moods }: { faces: (FaceT | Record<string, unknown>)[]; size?: number; moods?: Mood[] }) {
  const shown = faces.slice(0, 3);
  if (shown.length <= 1) return shown[0] ? <Face face={shown[0]} size={size} mood={moods?.[0]} /> : <span className="face-stack" style={{ width: size, height: size }} />;
  const s = Math.round(size * (shown.length === 2 ? 0.66 : 0.58));
  const spots = shown.length === 2 ? [[0, 0], [size - s, size - s]] : [[(size - s) / 2, 0], [0, size - s], [size - s, size - s]];
  return (
    <span className="face-stack" style={{ width: size, height: size }}>
      {shown.map((f, i) => (
        <span key={i} style={{ left: spots[i]?.[0], top: spots[i]?.[1], zIndex: 3 - i }}>
          <Face face={f} size={s} mood={moods?.[i]} />
        </span>
      ))}
    </span>
  );
}
