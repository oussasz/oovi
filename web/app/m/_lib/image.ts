"use client";

// A profile photo, as the website's account page made it: center-cropped square, at most 256 px, at most 200 KB
// (the size PATCH /api/v1/me accepts). Errors are i18n keys.
const MAX_IMAGE = 200 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("acct.photoUnreadable"));
    };
    img.src = url;
  });
}

export async function photoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("acct.photoNotImage");
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const out = Math.min(256, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("acct.photoUnreadable");
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  if (file.type === "image/png") {
    ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_IMAGE) return png;
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
    const jpg = canvas.toDataURL("image/jpeg", q);
    if (jpg.length <= MAX_IMAGE) return jpg;
  }
  throw new Error("acct.photoTooBig");
}
