// Slime avatars: a face is a handful of small numbers, so bots are easy to
// store, randomise and edit. Drawing lives in components/Face.tsx.

/** Soft pastel slimes (the first three come from the logo). */
export const FACE_COLORS = [
  "#A9BCF7", // blue
  "#FDDA80", // yellow
  "#FF9F86", // coral
  "#D8D5A6", // olive
  "#E5B08C", // tan
  "#EDB9BB", // pink
  "#E4E4E0", // grey
  "#BBD8C4", // mint
  "#CDBFEA", // lilac
] as const;

export const SHAPES = ["round", "drop", "mochi", "bean"] as const;
export const HAIR = ["none", "curls", "spikes", "fringe", "waves", "tuft", "cloud", "bun"] as const;
export const EYES = ["dots", "dashes", "wide", "sleepy"] as const;
export const NOSES = ["none", "hook", "line"] as const;
export const MOUTHS = ["smile", "grin", "calm", "smirk"] as const;
export const CHEEKS = ["none", "blush", "freckles", "hearts"] as const;
/** Things on top of the head. */
export const TOPS = ["none", "hat", "beret", "headphones", "crown", "bow", "flower", "cap", "catears", "halo", "horns", "sprout"] as const;
/** Things on the face. */
export const WEAR = ["none", "glasses", "shades", "monocle", "mustache", "patch", "star"] as const;

export type Face = { color: number; shape: number; hair: number; eyes: number; nose: number; mouth: number; cheeks: number; top: number; wear: number };

/** Faces react to what the bot is doing. */
export type Mood = "idle" | "thinking" | "working" | "asking" | "happy" | "sad";

const pick = (n: number) => Math.floor(Math.random() * n);

export function randomFace(): Face {
  return {
    color: pick(FACE_COLORS.length),
    shape: pick(SHAPES.length),
    hair: pick(HAIR.length),
    eyes: pick(EYES.length),
    nose: pick(NOSES.length),
    mouth: pick(MOUTHS.length),
    cheeks: Math.random() < 0.55 ? 1 : pick(CHEEKS.length),
    top: Math.random() < 0.5 ? 0 : 1 + pick(TOPS.length - 1),
    wear: Math.random() < 0.6 ? 0 : 1 + pick(WEAR.length - 1),
  };
}

const clamp = (v: unknown, n: number, fallback = 0) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(n - 1, Math.max(0, x)) : fallback;
};

// Older faces had one "extra" slot; map it to the new top/wear slots.
const LEGACY_EXTRAS = ["none", "glasses", "shades", "hat", "beret", "headphones", "mustache", "patch"];

/** Fill in missing fields (and convert old faces) so any stored face draws correctly. */
export function normalizeFace(f: unknown): Face {
  const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const has = (k: string) => typeof o[k] === "number";
  let top = has("top") ? o.top : 0;
  let wear = has("wear") ? o.wear : 0;
  if (!has("top") && !has("wear") && has("extra")) {
    const name = LEGACY_EXTRAS[Number(o.extra)] ?? "none";
    const ti = (TOPS as readonly string[]).indexOf(name);
    const wi = (WEAR as readonly string[]).indexOf(name);
    if (ti > 0) top = ti;
    else if (wi > 0) wear = wi;
  }
  return {
    color: clamp(o.color, FACE_COLORS.length),
    shape: clamp(o.shape, SHAPES.length),
    hair: clamp(o.hair, HAIR.length),
    eyes: clamp(o.eyes, EYES.length),
    nose: clamp(o.nose, NOSES.length),
    mouth: clamp(o.mouth, MOUTHS.length),
    cheeks: has("cheeks") ? clamp(o.cheeks, CHEEKS.length) : 1,
    top: clamp(top, TOPS.length),
    wear: clamp(wear, WEAR.length),
  };
}

export const cleanFace = normalizeFace;
