// Slime avatars: a face is a handful of small numbers, so bots are easy to
// store, randomise and edit. Drawing lives in components/Face.tsx.
// Option lists are append-only: saved bots store indices, so never reorder.

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

/** Body outlines: soft, slightly lopsided pebbles like the logo. */
export const SHAPES = ["round", "drop", "mochi", "bean", "pebble"] as const;
export const HAIR = ["none", "curls", "spikes", "fringe", "waves", "tuft", "cloud", "bun", "loop"] as const;
/** "dashes" is the logo look and the default. */
export const EYES = ["dots", "dashes", "wide", "sleepy", "ticks"] as const;
export const NOSES = ["none", "hook", "line"] as const;
export const MOUTHS = ["smile", "grin", "calm", "smirk", "none", "hook"] as const;
export const CHEEKS = ["none", "blush", "freckles", "hearts"] as const;
/** Things on top of the head. */
export const TOPS = ["none", "hat", "beret", "headphones", "crown", "bow", "flower", "cap", "catears", "halo", "horns", "sprout"] as const;
/** Things on the face. */
export const BEARDS = ["none", "light white", "stubble", "full dark"] as const;
export const WEAR = ["none", "glasses", "shades", "monocle", "mustache", "patch", "star"] as const;

/** beard: optional (older faces have none). */
export type Face = { color: number; shape: number; hair: number; eyes: number; nose: number; mouth: number; cheeks: number; top: number; wear: number; beard?: number };

/**
 * What the bot is doing, shown on its face.
 * idle/online: calm (online adds a green dot) · thinking: planning/reasoning ·
 * reading: web search, reading pages/files · computer: browsing, clicking, typing on the web ·
 * working: any other tool work · asking: waiting for the user · happy: done · sad: error/stuck ·
 * sleeping: paused/offline.
 */
export type Mood = "idle" | "online" | "thinking" | "reading" | "computer" | "working" | "asking" | "happy" | "sad" | "sleeping";
export const MOODS: readonly Mood[] = ["idle", "online", "thinking", "reading", "computer", "working", "asking", "happy", "sad", "sleeping"];

const pick = (n: number) => Math.floor(Math.random() * n);
const DASHES = 1;

export function randomFace(): Face {
  return {
    color: pick(FACE_COLORS.length),
    shape: pick(SHAPES.length),
    hair: Math.random() < 0.35 ? 0 : pick(HAIR.length),
    eyes: Math.random() < 0.55 ? DASHES : pick(EYES.length),
    nose: Math.random() < 0.7 ? 0 : pick(NOSES.length),
    mouth: pick(MOUTHS.length),
    cheeks: Math.random() < 0.55 ? 1 : pick(CHEEKS.length),
    top: Math.random() < 0.6 ? 0 : 1 + pick(TOPS.length - 1),
    wear: Math.random() < 0.7 ? 0 : 1 + pick(WEAR.length - 1),
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
    eyes: has("eyes") ? clamp(o.eyes, EYES.length) : DASHES,
    nose: clamp(o.nose, NOSES.length),
    mouth: clamp(o.mouth, MOUTHS.length),
    cheeks: has("cheeks") ? clamp(o.cheeks, CHEEKS.length) : 1,
    top: clamp(top, TOPS.length),
    wear: clamp(wear, WEAR.length),
    ...(has("beard") && clamp(o.beard, BEARDS.length) > 0 ? { beard: clamp(o.beard, BEARDS.length) } : {}),
  };
}

export const cleanFace = normalizeFace;
