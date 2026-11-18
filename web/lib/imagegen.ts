// AI pictures for the user's oovi (FLUX.1 schnell on Cloudflare Workers AI): a description in, a picture out.
// oovi's own Cloudflare account (Admin > theOovi > Pictures, or CF_ACCOUNT_ID + CF_API_TOKEN): its free daily
// allowance covers about 200 pictures a day; above it, pictures stop until midnight UTC unless the account is
// on a paid plan. Nothing is kept here: neither the description nor the picture.
import { pool } from "./db";
import { sealSecret, unsealSecret, type Sealed } from "./ai-config";
import { SIZES, type PictureShape } from "./imagegen-core";

type Cf = { accountId: string; token: string };
const g = globalThis as typeof globalThis & { __ooviImg?: { v: Cf | null; at: number } };
export const ACCOUNT_RE = /^[0-9a-f]{32}$/;

export async function imageKey(): Promise<Cf | null> {
  const c = g.__ooviImg;
  if (c && Date.now() - c.at < 15_000) return c.v;
  let v: Cf | null = null;
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'img_secret'");
    const s = rows[0]?.value as Sealed | undefined;
    if (s?.data) {
      const j = JSON.parse(unsealSecret(s)) as Cf;
      if (ACCOUNT_RE.test(j.accountId) && j.token) v = j;
    }
  } catch (err) {
    console.error("image key read failed", err instanceof Error ? err.message : "unknown error");
  }
  if (!v && process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) v = { accountId: process.env.CF_ACCOUNT_ID, token: process.env.CF_API_TOKEN };
  g.__ooviImg = { v, at: Date.now() };
  return v;
}

export async function saveImageKey(v: Cf | null, by: string): Promise<void> {
  if (v === null) await pool.query("DELETE FROM app_config WHERE key = 'img_secret'");
  else
    await pool.query(
      `INSERT INTO app_config (key, value, updated_at, updated_by) VALUES ('img_secret', $1::jsonb, now(), $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(sealSecret(JSON.stringify(v))), by],
    );
  g.__ooviImg = undefined;
}

export async function imageKeyInfo(): Promise<{ source: "console" | "env" | "none"; hint: string | null }> {
  try {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'img_secret'");
    const s = rows[0]?.value as Sealed | undefined;
    if (s?.data) {
      const j = JSON.parse(unsealSecret(s)) as Cf;
      return { source: "console", hint: `account …${j.accountId.slice(-4)}, token …${j.token.slice(-4)}` };
    }
  } catch {
    /* falls through */
  }
  if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) return { source: "env", hint: `account …${process.env.CF_ACCOUNT_ID.slice(-4)}` };
  return { source: "none", hint: null };
}

export class PictureError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A JPEG picture (base64) for the description. */
export async function drawPicture(prompt: string, shape: PictureShape, k: Cf): Promise<string> {
  const [width, height] = SIZES[shape];
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${k.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { authorization: `Bearer ${k.token}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, steps: 4, width, height }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = (await r.json().catch(() => null)) as { result?: { image?: string }; success?: boolean; errors?: { code?: number; message?: string }[] } | null;
  if (r.ok && j?.result?.image) return j.result.image;
  const msg = (j?.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`).join("; ");
  console.error("picture failed", r.status, msg.slice(0, 300));
  // The free daily allowance is used up (Cloudflare answers 429 / "neurons" / 4006).
  if (r.status === 429 || /neuron|4006|daily|quota|limit/i.test(msg)) throw new PictureError("Pictures are resting until tomorrow (the free daily limit is reached). Try again after midnight UTC.", 503);
  if (/nsfw|safety|flagged/i.test(msg)) throw new PictureError("That picture can't be made. Describe it differently.", 422);
  throw new PictureError("The picture couldn't be made. Try again in a moment.", 502);
}
