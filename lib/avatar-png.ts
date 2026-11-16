// The check on a marketplace picture (lib/faces.ts Face.image), the same in the app (lib/avatars.ts) and
// on the website (web/lib/avatars.ts, which has an identical copy of this file: tests/unit/avatars.test.mts).
// No imports, so tests run it as is.

export const MAX_AVATAR_BYTES = 300_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG no bigger than 1024×1024 and MAX_AVATAR_BYTES. */
export function isAvatarPng(b: Uint8Array): boolean {
  if (b.length < 33 || b.length > MAX_AVATAR_BYTES || PNG_MAGIC.some((x, i) => b[i] !== x)) return false;
  if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== "IHDR") return false;
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  const w = u32(16);
  const h = u32(20);
  return w > 0 && h > 0 && w <= 1024 && h <= 1024;
}
