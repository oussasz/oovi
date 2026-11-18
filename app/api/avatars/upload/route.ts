// A picture the user chose for a bot's face (the bot editor's "Your picture"): the screen sends a small square
// PNG (made in the browser from any photo); it is checked like a marketplace picture and kept on this computer.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isAvatarPng } from "@/lib/avatars";
import { guard } from "@/lib/guard";
import { dataDir } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => null)) as { png?: unknown } | null;
  const data = typeof b?.png === "string" ? Buffer.from(b.png.replace(/^data:image\/png;base64,/, ""), "base64") : null;
  if (!data || !isAvatarPng(data)) return Response.json({ error: "Use a picture (PNG, JPG or WebP)." }, { status: 400 });
  const id = crypto.createHash("sha256").update(data).digest("hex").slice(0, 32);
  const dir = path.join(dataDir(), "avatars");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.png`), data);
  return Response.json({ id }, { status: 201 });
}
