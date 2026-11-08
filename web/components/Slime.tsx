import type { CSSProperties } from "react";

export type SlimeColor = "blue" | "yellow" | "coral" | "mint" | "lilac";
export type SlimeShape = "egg" | "round" | "lump" | "drop" | "wide";
export type SlimeFace = "dash" | "smile" | "happy" | "focus" | "cool" | "wink" | "oh";
export type SlimeExtra = "curl" | "ticks" | "loops" | "none";

const PALETTE: Record<SlimeColor, { light: string; base: string; deep: string }> = {
  blue: { light: "#CAD6FF", base: "#A9BCF7", deep: "#8FA5EC" },
  yellow: { light: "#FFEAB3", base: "#FDDA80", deep: "#F4C65B" },
  coral: { light: "#FFC3B3", base: "#FF9F86", deep: "#F4866B" },
  mint: { light: "#D8ECDF", base: "#BBD8C4", deep: "#A0C6AC" },
  lilac: { light: "#E4DBF7", base: "#CDBFEA", deep: "#B6A5DF" },
};

const SHAPES: Record<SlimeShape, string> = {
  egg: "M128 14 C168 24 194 74 184 128 C176 170 136 192 90 186 C46 180 14 146 22 100 C28 64 46 40 70 26 C88 16 108 10 128 14 Z",
  round: "M84 28 C128 12 178 40 188 96 C198 150 162 188 108 188 C56 188 14 166 12 118 C10 76 44 42 84 28 Z",
  lump: "M112 16 C150 14 182 46 190 100 C198 158 160 190 104 188 C52 186 12 160 14 110 C16 76 34 58 56 44 C74 30 88 18 112 16 Z",
  drop: "M100 12 C122 38 178 64 182 118 C186 166 148 190 100 190 C52 190 14 166 18 118 C22 64 78 38 100 12 Z",
  wide: "M62 38 C98 16 152 22 178 58 C198 90 196 150 160 176 C126 198 66 196 36 170 C8 146 6 98 24 70 C32 56 46 46 62 38 Z",
};

const INK = "#171717";

function Face({ face, cx, cy }: { face: SlimeFace; cx: number; cy: number }) {
  const eye = (x: number, tilt = 2) => (
    <line x1={x - tilt} y1={cy - 10} x2={x + tilt} y2={cy + 8} stroke={INK} strokeWidth={9} strokeLinecap="round" />
  );
  switch (face) {
    case "dash":
      return <g className="slime-eyes">{eye(cx - 15)}{eye(cx + 15)}</g>;
    case "smile":
      return (
        <>
          <g className="slime-eyes">{eye(cx - 15)}{eye(cx + 15)}</g>
          <path d={`M${cx - 10} ${cy + 24} Q${cx} ${cy + 33} ${cx + 10} ${cy + 24}`} stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
        </>
      );
    case "happy":
      return (
        <>
          <g className="slime-eyes">{eye(cx - 16, 3)}{eye(cx + 14, 3)}</g>
          <path d={`M${cx - 4} ${cy + 18} C${cx - 6} ${cy + 32} ${cx + 12} ${cy + 32} ${cx + 10} ${cy + 18}`} stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
        </>
      );
    case "focus":
      return (
        <>
          <g className="slime-eyes">
            <line x1={cx - 24} y1={cy - 8} x2={cx - 10} y2={cy + 2} stroke={INK} strokeWidth={8} strokeLinecap="round" />
            <line x1={cx + 8} y1={cy - 6} x2={cx + 16} y2={cy + 8} stroke={INK} strokeWidth={8} strokeLinecap="round" />
          </g>
          <path d={`M${cx - 2} ${cy + 22} q8 6 14 -2`} stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
        </>
      );
    case "wink":
      return (
        <>
          <g className="slime-eyes">
            {eye(cx - 15)}
            <path d={`M${cx + 8} ${cy - 2} q8 -8 16 0`} stroke={INK} strokeWidth={7} strokeLinecap="round" fill="none" />
          </g>
          <path d={`M${cx - 8} ${cy + 22} Q${cx + 2} ${cy + 30} ${cx + 12} ${cy + 20}`} stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
        </>
      );
    case "oh":
      return (
        <>
          <g className="slime-eyes">{eye(cx - 14, 1)}{eye(cx + 14, 1)}</g>
          <ellipse cx={cx} cy={cy + 26} rx={5} ry={6} fill={INK} />
        </>
      );
    case "cool":
      return (
        <>
          <g>
            <circle cx={cx - 20} cy={cy} r={15} fill={INK} />
            <circle cx={cx + 20} cy={cy} r={15} fill={INK} />
            <line x1={cx - 6} y1={cy - 3} x2={cx + 6} y2={cy - 3} stroke={INK} strokeWidth={5} strokeLinecap="round" />
            <circle cx={cx - 25} cy={cy - 5} r={3.5} fill="#fff" opacity={0.85} />
            <circle cx={cx + 15} cy={cy - 5} r={3.5} fill="#fff" opacity={0.85} />
          </g>
          <path d={`M${cx - 8} ${cy + 26} Q${cx} ${cy + 32} ${cx + 8} ${cy + 26}`} stroke={INK} strokeWidth={6} strokeLinecap="round" fill="none" />
        </>
      );
  }
}

function Extra({ extra }: { extra: SlimeExtra }) {
  if (extra === "curl") {
    return <path d="M118 18 c-4 -16 18 -22 20 -8 c2 12 -14 12 -12 2" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />;
  }
  if (extra === "loops") {
    return (
      <path
        d="M78 24 c-6 -14 12 -22 16 -10 c3 9 -10 12 -9 3 c2 -12 22 -14 24 -2 c2 10 -12 12 -10 2"
        stroke={INK}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  if (extra === "ticks") {
    return (
      <g className="slime-ticks" stroke={INK} strokeWidth={6} strokeLinecap="round">
        <line x1={128} y1={10} x2={134} y2={-6} />
        <line x1={144} y1={18} x2={156} y2={6} />
      </g>
    );
  }
  return null;
}

type SlimeProps = {
  color: SlimeColor;
  shape?: SlimeShape;
  face?: SlimeFace;
  extra?: SlimeExtra;
  /** Face center inside the 200x200 box. */
  faceAt?: [number, number];
  /** Rotation of the face in degrees, for a bit of personality. */
  faceTilt?: number;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Animation delay in seconds so a group doesn't breathe in sync. */
  delay?: number;
  title?: string;
};

export function Slime({
  color,
  shape = "egg",
  face = "dash",
  extra = "none",
  faceAt = [100, 104],
  faceTilt = 0,
  size,
  className,
  style,
  delay = 0,
  title,
}: SlimeProps) {
  const p = PALETTE[color];
  const gid = `slime-grad-${color}`;
  const [cx, cy] = faceAt;
  return (
    <svg
      viewBox="-10 -20 220 220"
      className={`slime ${className ?? ""}`}
      style={{ width: size, ...style, ["--d" as string]: `${delay}s` }}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      overflow="visible"
    >
      <defs>
        <radialGradient id={gid} cx="32%" cy="28%" r="80%">
          <stop offset="0%" stopColor={p.light} />
          <stop offset="55%" stopColor={p.base} />
          <stop offset="100%" stopColor={p.deep} />
        </radialGradient>
      </defs>
      <g className="slime-body">
        <path d={SHAPES[shape]} fill={`url(#${gid})`} />
        <ellipse cx={68} cy={58} rx={20} ry={10} transform="rotate(-32 68 58)" fill="#fff" opacity={0.38} />
        <g transform={`rotate(${faceTilt} ${cx} ${cy})`}>
          <Face face={face} cx={cx} cy={cy} />
        </g>
        <Extra extra={extra} />
      </g>
    </svg>
  );
}
