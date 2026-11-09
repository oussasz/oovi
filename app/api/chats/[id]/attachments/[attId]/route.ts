import fs from "node:fs";
import { attachmentImage, attachmentPath, deleteAttachment, getAttachment } from "@/lib/attachments";
import { guard } from "@/lib/guard";
import { getChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; attId: string }> };

const INLINE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

/**
 * The file itself, for thumbnails and previews. Only images and PDFs are shown in the
 * page; everything else downloads, so an attached web page can never run in the app.
 *   ?thumb=1  the smaller copy made for models (images)
 *   ?path=1   {path} on this computer, for the desktop app's Open / Show in folder buttons
 */
export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id, attId } = await params;
  let att;
  try {
    att = getAttachment(id, attId);
  } catch {
    att = null;
  }
  if (!att) return Response.json({ error: "Attachment not found." }, { status: 404 });
  const url = new URL(req.url);
  const abs = attachmentPath(id, attId);
  if (!abs) return Response.json({ error: "The file is missing." }, { status: 404 });
  if (url.searchParams.get("path") === "1") return Response.json({ path: abs });

  const safe = { "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", "cache-control": "private, max-age=3600" };
  if (url.searchParams.get("thumb") === "1" && att.kind === "image") {
    const img = attachmentImage(id, attId);
    if (img) return new Response(new Uint8Array(img.data), { headers: { "content-type": img.mime, ...safe } });
  }
  const data = fs.readFileSync(abs);
  const inline = INLINE.has(att.mime);
  const encoded = encodeURIComponent(att.name);
  // The browser's PDF viewer refuses sandboxed documents; PDFs can't run scripts in the app anyway.
  const headers: Record<string, string> = { ...safe };
  if (att.mime === "application/pdf") delete headers["content-security-policy"];
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": inline ? att.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${att.name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encoded}`,
      ...headers,
    },
  });
}

/** Remove an upload that hasn't been sent yet (sent files stay with their message). */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id, attId } = await params;
  const chat = getChat(id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  if (chat.entries.some((e) => e.kind === "user" && e.attachments?.some((a) => a.id === attId))) return Response.json({ error: "This file belongs to a sent message." }, { status: 409 });
  try {
    deleteAttachment(id, attId);
  } catch {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
