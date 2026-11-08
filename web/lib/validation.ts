export const MAX_IMAGE_DATA_URL_LENGTH = 200 * 1024; // 200 KB of data URL text
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Returns an error message, or null when the image value is acceptable. */
export function validateImage(image: unknown): string | null {
  if (image === null || image === undefined || image === "") return null;
  if (typeof image !== "string") return "Image must be a data URL string or null.";
  if (image.length > MAX_IMAGE_DATA_URL_LENGTH) return "Image is too large (max 200 KB).";
  if (!IMAGE_DATA_URL_RE.test(image)) return "Image must be a PNG, JPEG or WebP data URL.";
  return null;
}

export function validateName(name: unknown): string | null {
  if (typeof name !== "string") return "Name must be a string.";
  const trimmed = name.trim();
  if (trimmed.length < 1) return "Please enter your name.";
  if (trimmed.length > 80) return "Name is too long (max 80 characters).";
  return null;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
