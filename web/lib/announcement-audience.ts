// Who an announcement is for: everyone, or the people the owner chose (one address or several).
// The chosen addresses are kept in announcements.test_email, lower-cased and joined by commas ("" = everyone).
// Pure (no database): tests/unit/announcements.test.mts.

export const MAX_PEOPLE = 500;
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** What the owner typed (one per line, or separated by commas, semicolons or spaces) as clean addresses. */
export function parsePeople(text: string): { emails: string[]; bad: string[] } {
  const emails: string[] = [], bad: string[] = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const v = raw.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!v) continue;
    if (!EMAIL.test(v) || v.length > 254) bad.push(raw.trim().slice(0, 60));
    else if (!emails.includes(v)) emails.push(v);
  }
  return { emails, bad };
}

/** The chosen addresses of a stored announcement ([] = everyone). */
export const peopleOf = (stored: string): string[] => (stored ? stored.split(",").filter(Boolean) : []);

/** "Everyone", "sara@x.com" or "12 chosen people". */
export function audienceLabel(stored: string): string {
  const p = peopleOf(stored);
  return p.length === 0 ? "Everyone" : p.length === 1 ? p[0]! : `${p.length} chosen people`;
}

/** For chosen people: "ok", no oovi account (nothing is sent), or an address that was never confirmed (sent, but it may be mistyped). */
export type PersonState = "ok" | "no-account" | "not-confirmed";
export const STATE_WORDS: Record<Exclude<PersonState, "ok">, string> = {
  "no-account": "has no oovi account: they won’t get it",
  "not-confirmed": "never confirmed this address: it may be mistyped (the email is still sent)",
};

/** The owner's plain text as paragraphs (blank line = new paragraph). */
export const paragraphs = (text: string): string[] =>
  String(text ?? "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
export const MAX_MESSAGE = 5000;
