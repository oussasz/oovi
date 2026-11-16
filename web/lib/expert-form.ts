// "Become an expert on oovi": the request form (/experts/apply). Pure code (no database) so it can be unit tested:
// the consent text and its version, what is asked, and the checks on every field and on the drawn signature.
import crypto from "node:crypto";
import zlib from "node:zlib";

// ---------- the consent text ----------
// A plain-language DRAFT, not legal advice. One constant, versioned: when the words change, change CONSENT_VERSION,
// and every saved request keeps the version and the hash of the exact text its author saw.
export const CONSENT_VERSION = "2026-11-16-1";
export const CONSENT_TEXT: readonly string[] = [
  "This is a request, not a contract. I am asking oovi to consider adding an AI assistant based on my expertise to the oovi Marketplace.",
  "oovi will review my request and can accept or decline it. Nothing will be published with my name, my photo or my words until I and oovi have agreed the details in writing.",
  "I confirm that what I wrote above is true, and that I have the right to use my name and the profile I linked to.",
  "I can withdraw this request, or ask to stop being an expert on oovi, at any time by writing to oovi.",
  "oovi keeps this request, my signature, the date and the version of this text, so there is a record of what I agreed to. This information is used only to handle my request.",
];


export const consentHash = (text: readonly string[] = CONSENT_TEXT): string => crypto.createHash("sha256").update(text.join("\n")).digest("hex");

// ---------- what is asked ----------
export const LANGUAGES = [
  { value: "ar", label: "Arabic" },
  { value: "darija", label: "Darija" },
  { value: "fr", label: "French" },
  { value: "en", label: "English" },
  { value: "other", label: "Another language" },
] as const;
export type LangValue = (typeof LANGUAGES)[number]["value"];
const LANG_VALUES: readonly string[] = LANGUAGES.map((l) => l.value);

export const LIMITS = { name: 100, email: 254, url: 300, field: 120, bio: 600, knownAs: 80 } as const;
export const MIN_BIO = 20;

export type ExpertInput = {
  name: string;
  email: string;
  profileUrl: string;
  field: string;
  bio: string;
  languages: LangValue[];
  knownAs: string;
  signedName: string;
  /** The person could not draw: the typed name is the signature. */
  typedOnly: boolean;
  signature: Buffer | null;
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const noControl = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
export const sameName = (a: string, b: string) => squash(a).toLocaleLowerCase("en") === squash(b).toLocaleLowerCase("en");

export function isEmailAddress(v: string): boolean {
  return v.length <= LIMITS.email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(v);
}

/** An https link to a public profile. Returns the cleaned link or null. */
export function cleanProfileUrl(v: string): string | null {
  const s = v.trim();
  if (!s || s.length > LIMITS.url) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- the drawn signature ----------
export const MAX_SIGNATURE_BYTES = 150_000;
export const MAX_SIGNATURE_W = 1000;
export const MAX_SIGNATURE_H = 500;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A "data:image/png;base64,..." string from the signature pad, checked: it really is a PNG (magic bytes and chunks), small,
 * not huge in pixels, and not blank (the pad draws ink on a transparent picture, so a blank one inflates to zeros).
 * Returns the PNG bytes, or a reason in plain words.
 */
export function checkSignature(dataUrl: string): { ok: true; png: Buffer } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl.slice(0, MAX_SIGNATURE_BYTES * 2));
  if (!m) return bad("The signature could not be read. Please draw it again.");
  const png = Buffer.from(m[1]!, "base64");
  if (png.length > MAX_SIGNATURE_BYTES) return bad("The signature picture is too big. Please clear it and draw it again, a bit smaller.");
  if (png.length < 60 || !png.subarray(0, 8).equals(PNG_MAGIC)) return bad("The signature could not be read. Please draw it again.");
  let off = 8;
  let w = 0;
  let h = 0;
  let sawEnd = false;
  const idat: Buffer[] = [];
  while (off + 12 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    if (len > png.length || off + 12 + len > png.length) return bad("The signature could not be read. Please draw it again.");
    const body = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      if (len !== 13) return bad("The signature could not be read. Please draw it again.");
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    off += 12 + len;
  }
  if (!sawEnd || !w || !h) return bad("The signature could not be read. Please draw it again.");
  if (w > MAX_SIGNATURE_W || h > MAX_SIGNATURE_H) return bad("The signature picture is too big. Please clear it and draw it again.");
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: MAX_SIGNATURE_W * MAX_SIGNATURE_H * 4 + MAX_SIGNATURE_H + 16 });
  } catch {
    return bad("The signature could not be read. Please draw it again.");
  }
  // Each row starts with one filter byte; ink makes at least one other byte non-zero.
  const stride = raw.length / h;
  let ink = false;
  if (Number.isInteger(stride) && stride > 1) {
    for (let y = 0; y < h && !ink; y++) for (let x = 1; x < stride; x++) if (raw[y * stride + x] !== 0) { ink = true; break; }
  }
  if (!ink) return bad("Please draw your signature in the box.");
  return { ok: true, png };
}

// ---------- the whole form ----------
type Get = (key: string) => string | string[] | null | undefined;
const one = (g: Get, k: string, max: number): string => {
  const v = g(k);
  return typeof v === "string" ? noControl(v).slice(0, max) : "";
};

export type ParsedExpert = { errors: string[]; value: ExpertInput | null; honeypot: boolean };

export function parseExpertForm(get: Get): ParsedExpert {
  const errors: string[] = [];
  // A field real people never see: when a script fills it, the request is dropped without a word.
  const honeypot = one(get, "website", 200).trim() !== "";

  const name = squash(one(get, "name", LIMITS.name + 20));
  const email = one(get, "email", LIMITS.email + 20).trim().toLowerCase();
  const profileRaw = one(get, "profileUrl", LIMITS.url + 20);
  const field = squash(one(get, "field", LIMITS.field + 20));
  const bio = one(get, "bio", LIMITS.bio + 200).replace(/\r/g, "").trim();
  const knownAs = squash(one(get, "knownAs", LIMITS.knownAs + 20));
  const signedName = squash(one(get, "signedName", LIMITS.name + 20));
  const typedOnly = one(get, "typedOnly", 10) === "on";
  const consent = one(get, "consent", 10) === "on";
  const seenVersion = one(get, "consentVersion", 40);
  const sig = one(get, "signature", MAX_SIGNATURE_BYTES * 2 + 100);

  const langsRaw = get("languages");
  const langs = (Array.isArray(langsRaw) ? langsRaw : typeof langsRaw === "string" ? [langsRaw] : []).filter((x) => LANG_VALUES.includes(x));
  const languages = [...new Set(langs)] as LangValue[];

  if (name.length < 2) errors.push("Please write your full name.");
  else if (name.length > LIMITS.name) errors.push(`Your name must be under ${LIMITS.name} characters.`);
  if (!isEmailAddress(email)) errors.push("Please write an email address we can reach you on.");
  const profileUrl = cleanProfileUrl(profileRaw);
  if (!profileUrl) errors.push("Please add a link to your public profile (for example LinkedIn). It must start with https://");
  if (field.length < 3) errors.push("Tell us in a few words what you are an expert in.");
  else if (field.length > LIMITS.field) errors.push(`“What you are an expert in” must be under ${LIMITS.field} characters.`);
  if (bio.length < MIN_BIO) errors.push(`Write a short bio (at least ${MIN_BIO} characters).`);
  else if (bio.length > LIMITS.bio) errors.push(`Your bio must be under ${LIMITS.bio} characters.`);
  if (!languages.length) errors.push("Pick at least one language you work in.");
  if (knownAs.length > LIMITS.knownAs) errors.push(`“How should your assistant be known” must be under ${LIMITS.knownAs} characters.`);

  if (seenVersion !== CONSENT_VERSION) errors.push("The statement below was updated. Please read it again, then confirm.");
  if (!consent) errors.push("Please confirm that you have read the statement and agree to it.");
  if (!signedName) errors.push("Type your full name as your signature.");
  else if (name.length >= 2 && !sameName(name, signedName)) errors.push("The name you typed as your signature must be the same as your full name above.");

  let signature: Buffer | null = null;
  if (typedOnly) {
    // For people who can't draw: the typed name alone is the signature.
  } else if (!sig) errors.push("Please draw your signature in the box (or tick “I can’t draw”).");
  else {
    const c = checkSignature(sig);
    if (c.ok) signature = c.png;
    else errors.push(c.error);
  }

  if (errors.length) return { errors, value: null, honeypot };
  return { errors, honeypot, value: { name, email, profileUrl: profileUrl!, field, bio, languages, knownAs, signedName, typedOnly, signature } };
}

/** A salted hash of the visitor's IP. The address itself is never stored. */
export function ipHash(ip: string | null, secret = process.env.BETTER_AUTH_SECRET ?? ""): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`oovi-expert:${secret}:${ip}`).digest("hex").slice(0, 32);
}

export const STATUSES = ["new", "accepted", "declined"] as const;
export type ExpertStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<ExpertStatus, string> = { new: "New", accepted: "Accepted", declined: "Declined" };
