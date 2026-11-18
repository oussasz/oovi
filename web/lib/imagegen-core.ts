// AI pictures for the user's oovi: checks on a picture request. Pure: tests/unit/imagegen.test.mts.

/** Descriptions oovi never draws: sexual content, and anything sexual or violent with children. EN/FR/AR. */
const BLOCK = [
  /\b(nude|naked|nsfw|porn|porno|sex|sexual|erotic|hentai|topless|lingerie|fetish|genitals?|nipples?)\b/i,
  /\b(nu|nue|nus|nues|pornographique|sexe|sexuel(le)?|érotique|seins nus)\b/i,
  /(عاري|عارية|إباحي|جنسي|جنسية|سكس)/,
  /\b(gore|beheading|decapitat\w*|dismember\w*|corpse|torture)\b/i,
];
const CHILD = /\b(child|children|kid|kids|minor|minors|teen|teens|underage|boy|girl|enfant|enfants|mineur|fille|garçon)\b|(طفل|أطفال|قاصر|بنت|ولد)/i;

/** null when the description can be drawn; else why not (said to the bot, which tells the user). */
export function pictureRefusal(prompt: string): string | null {
  const p = String(prompt ?? "");
  if (!p.trim()) return "Describe the picture.";
  if (p.length > 2000) return "That description is too long (2,000 characters at most).";
  if (BLOCK.some((r) => r.test(p))) return "oovi doesn't make sexual, nude or gory pictures.";
  if (CHILD.test(p) && /\b(sexy|bikini|kiss|bed|undress\w*|seductive)\b/i.test(p)) return "oovi doesn't make that kind of picture of children.";
  return null;
}

export const SIZES = { square: [1024, 1024], portrait: [768, 1024], landscape: [1024, 768] } as const;
export type PictureShape = keyof typeof SIZES;
/** Cloudflare's price for FLUX schnell (2026-11): 4.80 neurons per 512×512 tile + 9.60 per step; $0.011 per 1,000 neurons. */
export function pictureUsd(shape: PictureShape, steps = 4): number {
  const [w, h] = SIZES[shape];
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  return ((tiles * 4.8 + steps * 9.6) * 0.011) / 1000;
}
