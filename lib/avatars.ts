// Marketplace pictures (lib/faces.ts Face.image) kept on this computer: downloaded once from the oovi
// service, checked (a real, small PNG), then served from disk, so they show offline and nothing is
// fetched again. Pure checks are exported for tests.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cloud, cloudUrl } from "./account";
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

// ---------- the user's own pictures, kept on their account (phone, web, other computers) ----------

const sentFile = () => path.join(dir(), "sent.json");
function sentIds(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(sentFile(), "utf8")) as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Sends the pictures these bots use that are only on this computer (made with "Your picture") to the account, once
 * each, so the phone, the web app and other computers show the same face. Best effort: offline, it tries next time.
 */
export async function sendOwnAvatars(ids: string[]): Promise<void> {
  const sent = sentIds();
  let changed = false;
  for (const id of [...new Set(ids)]) {
    if (!IMAGE_ID.test(id) || sent.has(id)) continue;
    let png: Buffer;
    try {
      png = fs.readFileSync(path.join(dir(), `${id}.png`));
    } catch {
      continue; // a marketplace picture not downloaded here, or gone: nothing to send
    }
    // Only pictures made on this computer (their id is the sha256 of the bytes); marketplace ones are already there.
    if (crypto.createHash("sha256").update(png).digest("hex").slice(0, 32) !== id || !isAvatarPng(png)) continue;
    try {
      await cloud<{ id: string }>("/api/v1/avatars", { method: "POST", auth: true, body: { png: png.toString("base64") } });
      sent.add(id);
      changed = true;
    } catch {
      break; // signed out or offline: next sync
    }
  }
  if (changed) {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(sentFile(), JSON.stringify([...sent].slice(-1000)));
  }
}
