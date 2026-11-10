// Uploading a file to a Telegram chat (sendDocument / sendPhoto) as multipart/form-data.
// No imports from the rest of oovi, so it can be tested on its own without a bot token.

import crypto from "node:crypto";

/** Telegram's limit for files bots upload. */
export const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;
/** Photos above this go as documents (Telegram's sendPhoto limit). */
export const TELEGRAM_PHOTO_MAX = 10 * 1024 * 1024;
const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

export type MultipartFile = { field: string; name: string; mime: string; data: Buffer };

/** Quote a value for a Content-Disposition header (RFC 7578: escape quotes and line breaks). */
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ");

/** A multipart/form-data body with text fields and one file. */
export function buildMultipart(fields: Record<string, string>, file: MultipartFile, boundary = `----oovi${crypto.randomBytes(12).toString("hex")}`): { body: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(k)}"\r\n\r\n${v}\r\n`, "utf8"));
  }
  // filename* carries non-ASCII names (é, Arabic…); filename is the ASCII fallback.
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_");
  const star = /[^\x20-\x7e]/.test(file.name) ? `; filename*=UTF-8''${encodeURIComponent(file.name)}` : "";
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.field)}"; filename="${quote(ascii)}"${star}\r\nContent-Type: ${file.mime}\r\n\r\n`, "utf8"),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/**
 * The HTTP request that sends a file to a Telegram chat: images as photos (shown inline),
 * everything else as a document. Returns an error message when the file is too big.
 */
export function telegramUploadRequest(
  token: string,
  chatId: number,
  file: { name: string; data: Buffer },
  caption?: string,
  /** Telegram's API address (tests use a local stand-in). */
  api = "https://api.telegram.org",
): { method: "sendPhoto" | "sendDocument"; url: string; init: { method: "POST"; headers: Record<string, string>; body: Buffer } } | { error: string } {
  const size = file.data.length;
  if (size > TELEGRAM_MAX_BYTES) {
    return { error: `"${file.name}" is ${(size / 1048576).toFixed(1)} MB. Telegram only lets bots send files up to 50 MB, so it can't go there. The user can open it on the computer, or you can put it in a cloud folder (e.g. through a connector) and share a link.` };
  }
  if (!size) return { error: `"${file.name}" is empty.` };
  const photo = PHOTO_EXT.test(file.name) && size <= TELEGRAM_PHOTO_MAX;
  const method = photo ? "sendPhoto" : "sendDocument";
  const fields: Record<string, string> = { chat_id: String(chatId) };
  if (caption?.trim()) fields.caption = caption.trim().slice(0, 1000);
  const { body, contentType } = buildMultipart(fields, { field: photo ? "photo" : "document", name: file.name, mime: mimeOf(file.name), data: file.data });
  return { method, url: `${api}/bot${token}/${method}`, init: { method: "POST", headers: { "content-type": contentType }, body } };
}
