import { MAX_ATTACHMENT_BYTES, pruneAttachments, saveAttachment } from "@/lib/attachments";
import { guard } from "@/lib/guard";
import { getChat } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const g = globalThis as typeof globalThis & { __ooviAttPrune?: number };

/**
 * Upload one file for the next message: the raw bytes as the body, the file name in
 * the x-file-name header (URI-encoded). Returns {attachment} or {error}.
 */
export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const chat = getChat(id);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });
  let name = "file";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "file");
  } catch {
    name = req.headers.get("x-file-name") ?? "file";
  }
  const limitMb = MAX_ATTACHMENT_BYTES / 1048576;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES) return Response.json({ error: `"${name}" is larger than ${limitMb} MB.` }, { status: 413 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length > MAX_ATTACHMENT_BYTES) return Response.json({ error: `"${name}" is larger than ${limitMb} MB.` }, { status: 413 });

  // Housekeeping, at most once an hour: unsent uploads and files of deleted chats.
  if (!g.__ooviAttPrune || Date.now() - g.__ooviAttPrune > 3600_000) {
    g.__ooviAttPrune = Date.now();
    try {
      pruneAttachments(chat);
    } catch {
      /* never block an upload on cleanup */
    }
  }

  const out = await saveAttachment(id, name, data);
  if ("error" in out) return Response.json({ error: out.error }, { status: 400 });
  return Response.json({ attachment: out });
}
