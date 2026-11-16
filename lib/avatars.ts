// Marketplace pictures (lib/faces.ts Face.image) kept on this computer: downloaded once from the oovi
// service, checked (a real, small PNG), then served from disk, so they show offline and nothing is
// fetched again. Pure checks are exported for tests.

import fs from "node:fs";
import path from "node:path";
import { cloudUrl } from "./account";
import { IMAGE_ID } from "./faces";
import { dataDir } from "./settings";

import { MAX_AVATAR_BYTES, isAvatarPng } from "./avatar-png";
export { MAX_AVATAR_BYTES, isAvatarPng };

const dir = () => path.join(dataDir(), "avatars");
const pending = new Map<string, Promise<Buffer | null>>();

/** The picture, from disk or downloaded once. null when it doesn't exist or can't be reached now. */
export async function avatarPng(id: string): Promise<Buffer | null> {
  if (!IMAGE_ID.test(id)) return null;
  const file = path.join(dir(), `${id}.png`);
  try {
    const b = fs.readFileSync(file);
    if (isAvatarPng(b)) return b;
  } catch {
    /* not downloaded yet */
  }
  const running = pending.get(id);
  if (running) return running;
  const job = (async () => {
    try {
      const res = await fetch(`${cloudUrl()}/api/v1/avatars/${id}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const b = Buffer.from(await res.arrayBuffer());
      if (!isAvatarPng(b)) return null;
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(file, b);
      return b;
    } catch {
      return null; // offline: the slime shows, and it is tried again next time
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, job);
  return job;
}
