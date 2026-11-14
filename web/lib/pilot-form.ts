// The pilot request form: the questions, their choices, and the checks that run on the server.
// Safe to import from client components (no database here). Everything is a tap on a choice, a star or a face;
// free text is only for "Something else" and one optional note. The answers are stored as one JSON object
// (pilot_requests.answers) so questions can change without a new column each time.

/** `icon` is a small emoji; `brand` names a real logo drawn by components/BrandIcon.tsx. */
export type Opt = { value: string; label: string; icon?: string; brand?: string };

export const ROLES: Opt[] = [
  { value: "freelancer", label: "Freelancer", icon: "💼" },
  { value: "owner", label: "Business owner", icon: "🏪" },
  { value: "employee", label: "Employee", icon: "🏢" },
  { value: "developer", label: "Developer", icon: "💻" },
  { value: "creator", label: "Content creator or marketer", icon: "🎬" },
  { value: "student", label: "Student or researcher", icon: "🎓" },
  { value: "other", label: "Something else", icon: "✨" },
];
export const SYSTEMS: Opt[] = [
  { value: "windows", label: "Windows" },
  { value: "mac", label: "Mac" },
  { value: "linux", label: "Linux" },
];
export const USES: Opt[] = [
  { value: "research", label: "Web research", icon: "🔎" },
  { value: "leads", label: "Lists of businesses or leads", icon: "📇" },
  { value: "writing", label: "Writing and content", icon: "✍️" },
  { value: "social", label: "Social media", icon: "📣" },
  { value: "support", label: "Replies to customers", icon: "💬" },
  { value: "code", label: "Reviewing or building apps", icon: "🧩" },
  { value: "data", label: "Data and spreadsheets", icon: "📊" },
  { value: "office", label: "Office and admin tasks", icon: "🗂️" },
  { value: "learning", label: "Learning and studying", icon: "📚" },
  { value: "other", label: "Something else", icon: "✨" },
];
export const LANGUAGES: Opt[] = [
  { value: "ar", label: "Arabic" },
  { value: "darija", label: "Darija" },
  { value: "fr", label: "French" },
  { value: "en", label: "English" },
  { value: "other", label: "Another language" },
];
export const TOOLS: Opt[] = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "copilot", label: "Copilot" },
  { value: "perplexity", label: "Perplexity" },
  { value: "none", label: "None yet" },
  { value: "other", label: "Another one" },
];
export const HEARD: Opt[] = [
  { value: "youtube", label: "YouTube", brand: "youtube" },
  { value: "facebook", label: "Facebook", brand: "facebook" },
  { value: "instagram", label: "Instagram", brand: "instagram" },
  { value: "tiktok", label: "TikTok", brand: "tiktok" },
  { value: "linkedin", label: "LinkedIn", brand: "linkedin" },
  { value: "x", label: "X (Twitter)", brand: "x" },
  { value: "telegram", label: "Telegram", brand: "telegram" },
  { value: "whatsapp", label: "WhatsApp", brand: "whatsapp" },
  { value: "google", label: "Google search", brand: "google" },
  { value: "store", label: "Microsoft Store", brand: "microsoft" },
  { value: "github", label: "GitHub", brand: "github" },
  { value: "friend", label: "A friend or colleague", brand: "friend" },
  { value: "other", label: "Somewhere else", brand: "other" },
];
export const IMPROVE: Opt[] = [
  { value: "speed", label: "Speed", icon: "⚡" },
  { value: "quality", label: "Better answers", icon: "🎯" },
  { value: "start", label: "Easier to start", icon: "🚪" },
  { value: "price", label: "Price and credits", icon: "💰" },
  { value: "languages", label: "More languages", icon: "🌍" },
  { value: "phone", label: "A phone app", icon: "📲" },
  { value: "tools", label: "More tools and connections", icon: "🔌" },
  { value: "mistakes", label: "Fewer mistakes", icon: "🛠️" },
  { value: "other", label: "Something else", icon: "✨" },
];
export const PAY: Opt[] = [
  { value: "free", label: "Nothing, free only" },
  { value: "u5", label: "Under $5" },
  { value: "5-10", label: "$5 to $10" },
  { value: "10-20", label: "$10 to $20" },
  { value: "20-40", label: "$20 to $40" },
  { value: "40+", label: "More than $40" },
];
export const PAY_METHODS: Opt[] = [
  { value: "card", label: "International bank card (Visa, Mastercard)", icon: "💳" },
  { value: "paypal", label: "PayPal", icon: "🅿️" },
  { value: "local", label: "Local cards only (CIB, Edahabia...)", icon: "🏦" },
  { value: "none", label: "I can't pay online yet", icon: "🙅" },
];
export const MOBILE: Opt[] = [
  { value: "yes", label: "Yes, I'd use it" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No, computer only" },
];
export const CALL: Opt[] = [
  { value: "yes", label: "Yes, happy to" },
  { value: "later", label: "Maybe later" },
  { value: "no", label: "No thanks" },
];
/** The faces, from worst to best (1 to 5). */
export const FACES: { value: number; icon: string; label: string }[] = [
  { value: 1, icon: "😖", label: "Bad" },
  { value: 2, icon: "😕", label: "Not great" },
  { value: 3, icon: "😐", label: "Okay" },
  { value: 4, icon: "🙂", label: "Good" },
  { value: 5, icon: "🤩", label: "Loved it" },
];

export type PilotAnswers = {
  v: 1;
  role: string;
  system: string;
  uses: string[];
  languages: string[];
  tools: string[];
  heard: string;
  heardOther?: string;
  experience: number;
  improve: string[];
  pay?: string;
  payMethods: string[];
  mobile?: string;
  call?: string;
  contact?: string;
  quote?: boolean;
  extra?: string;
};

const values = (o: Opt[]) => new Set(o.map((x) => x.value));
export const labelOf = (o: Opt[], v: string | undefined | null) => o.find((x) => x.value === v)?.label ?? (v || "–");
export const labelsOf = (o: Opt[], vs: string[] | undefined) => (vs && vs.length ? vs.map((v) => labelOf(o, v)).join(", ") : "–");

const clean = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** One of the allowed values, or "" when missing or not on the list. */
function one(fd: FormData, key: string, allowed: Opt[]): string {
  const v = clean(fd.get(key), 40);
  return values(allowed).has(v) ? v : "";
}
/** The ticked allowed values (no repeats), at most `max`. */
function many(fd: FormData, key: string, allowed: Opt[], max: number): string[] {
  const ok = values(allowed);
  const out: string[] = [];
  for (const raw of fd.getAll(key)) {
    const v = clean(raw, 40);
    if (ok.has(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}
/** A rating is exactly 1, 2, 3, 4 or 5; anything else (4.5, 1e1, "abc") counts as no answer. */
function rating(fd: FormData, key: string): number {
  const raw = clean(fd.get(key), 12);
  return /^[1-5]$/.test(raw) ? Number(raw) : 0;
}

/** Reads and checks the form. Problems come back in plain English, one per missing or wrong answer. */
export function parseAnswers(fd: FormData): { errors: string[]; answers: PilotAnswers } {
  const errors: string[] = [];
  const role = one(fd, "role", ROLES);
  const system = one(fd, "system", SYSTEMS);
  const uses = many(fd, "uses", USES, 6);
  const heard = one(fd, "heard", HEARD);
  const payMethods = many(fd, "payMethods", PAY_METHODS, 4);
  const experience = rating(fd, "experience");
  if (!role) errors.push("Pick what describes you best.");
  if (!system) errors.push("Pick the computer you use.");
  if (!uses.length) errors.push("Pick at least one thing you'll use oovi for.");
  if (!heard) errors.push("Tell us where you heard about oovi.");
  if (!experience) errors.push("Choose a face for your first try with oovi.");
  if (!payMethods.length) errors.push("Tell us how you can pay online (or that you can't yet).");
  const answers: PilotAnswers = {
    v: 1,
    role,
    system,
    uses,
    languages: many(fd, "languages", LANGUAGES, 5),
    tools: many(fd, "tools", TOOLS, 7),
    heard,
    experience,
    improve: many(fd, "improve", IMPROVE, 3),
    payMethods,
  };
  const heardOther = clean(fd.get("heardOther"), 80);
  if (heard === "other" && heardOther) answers.heardOther = heardOther;
  const pay = one(fd, "pay", PAY);
  if (pay) answers.pay = pay;
  const mobile = one(fd, "mobile", MOBILE);
  if (mobile) answers.mobile = mobile;
  const call = one(fd, "call", CALL);
  if (call) answers.call = call;
  const contact = clean(fd.get("contact"), 80);
  if (contact) answers.contact = contact;
  if (fd.get("quote") === "on") answers.quote = true;
  const extra = clean(fd.get("extra"), 1000);
  if (extra) answers.extra = extra;
  return { errors, answers };
}

/** A stored value read back safely (older rows have none; a changed list never breaks the admin page). */
export function readAnswers(raw: unknown): PilotAnswers | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  const num = (k: string) => (typeof r[k] === "number" && r[k] >= 1 && r[k] <= 5 ? (r[k] as number) : undefined);
  return {
    v: 1,
    role: s("role") ?? "",
    system: s("system") ?? "",
    uses: arr("uses"),
    languages: arr("languages"),
    tools: arr("tools"),
    heard: s("heard") ?? "",
    heardOther: s("heardOther"),
    experience: num("experience") ?? 0,
    improve: arr("improve"),
    pay: s("pay"),
    payMethods: arr("payMethods"),
    mobile: s("mobile"),
    call: s("call"),
    contact: s("contact"),
    quote: r.quote === true ? true : undefined,
    extra: s("extra"),
  };
}

/** The text kept in pilot_requests.use_case (the old column): the person's note, or a line built from their choices. */
export function summaryLine(a: PilotAnswers): string {
  const uses = labelsOf(USES, a.uses);
  return a.extra ? a.extra : `${labelOf(ROLES, a.role)}. Will use oovi for: ${uses}.`;
}
