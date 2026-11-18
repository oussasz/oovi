// "Not confirmed": a reply that says something was sent, posted, booked or paid while nothing in the work
// behind it could have done that is marked for the user, so a false "done!" doesn't pass unnoticed.
// Plain text rules, no model call. Pure: tests/unit/receipts.test.mts.
import type { Msg } from "./types";

/** "I sent / posted / booked / paid / published / replied / submitted" in EN, FR, AR and Darija (past tense: done). */
const CLAIMS = [
  /\b(i(?:'ve| have)?|we(?:'ve| have)?)\s+(just\s+)?(sent|emailed|posted|published|booked|reserved|paid|ordered|submitted|replied|messaged|scheduled|uploaded|shared|deleted|cancell?ed|signed up|registered)\b/i,
  /\b(has|have) been (sent|posted|published|booked|paid|submitted|scheduled|uploaded|deleted)\b/i,
  /\b(j'ai|nous avons|c'est)\s+(bien\s+)?(envoyé|publié|posté|réservé|payé|commandé|soumis|répondu|programmé|téléversé|partagé|supprimé|annulé)(?=[\s.,;:!]|$)/i,
  /\b(a été|ont été)\s+(envoyée?s?|publiée?s?|réservée?s?|payée?s?|supprimée?s?)(?=[\s.,;:!]|$)/i,
  /(أرسلت|قمت بإرسال|نشرت|قمت بنشر|حجزت|دفعت|طلبت|قمت بالرد|رددت|جدولت|حذفت|ألغيت|تم الإرسال|تم النشر|تم الحجز|تم الدفع|تم الحذف|تم إرسال|تم نشر|تم حجز|تم دفع|تم حذف|تمت عملية)/,
  /(بعثت|بعثتلك|بعثتها|نشرتها|حجزت|خلصت|سيفطت|صيفطت|بلوكيت|مسحت)/,
  // Darija in Latin letters ("b3athtlek", "sayfatlek", "7jezt")
  /\b(b3at(h)?t(lek|lk|ha|hom|o|ou)?|ba3at(h)?t(lek|lk|ha)?|sayfat(lek|lk|ha|hom)?|sifat(lek|lk|ha)?|7jezt|hjezt|khalast|khlast|nsharit|nchrit|msa7t|ms7t|annulit|postit|publiit)\b/i,
];

/** The claim the reply makes, or null. Questions and plans ("shall I send", "I will send") are not claims. */
export function claimedAction(text: string): string | null {
  const t = String(text ?? "");
  for (const r of CLAIMS) {
    const m = r.exec(t);
    if (!m) continue;
    // The sentence around it: a question or a conditional is not a claim.
    const start = Math.max(t.lastIndexOf(".", m.index), t.lastIndexOf("\n", m.index), t.lastIndexOf("؟", m.index), t.lastIndexOf("?", m.index)) + 1;
    const end = t.slice(m.index).search(/[.!?؟\n]/);
    const sentence = t.slice(start, end < 0 ? undefined : m.index + end + 1).trim();
    if (/\?|؟/.test(sentence) || /\b(if|once|when|si|quand|dès que)\b|إذا|ايلا|كي /i.test(sentence.slice(0, Math.max(0, sentence.indexOf(m[0]))))) continue;
    return sentence.slice(0, 200) || m[0];
  }
  return null;
}

/**
 * Tools that act in the world (send, post, book, pay, change something): connector tools named with such a
 * verb, clicks and typing in a browser or on the computer, uploads, sending a file. Reading and searching
 * never count.
 */
const ACTS = /^(click|type|browser_steps|upload_file|send_file_to_user|send_screenshot|open_app|manage_window|computer|desktop_|work_export|create_document|create_spreadsheet|create_presentation|create_image|write_file|edit_file|run_command|propose_routine|message_group|vm_run)$|^mcp_.*(send|post|create|publish|reply|book|pay|submit|message|mail|tweet|comment|share|upload|delete|update|add|insert|schedule|invite|order)/i;

export function actedIn(steps: Msg[]): boolean {
  for (let i = 0; i < steps.length; i++) {
    const m = steps[i]!;
    if (m.role !== "assistant") continue;
    const next = steps[i + 1];
    for (const c of m.toolCalls) {
      if (!ACTS.test(c.name)) continue;
      const r = next?.role === "tool" ? next.results.find((x) => x.id === c.id) : undefined;
      if (r && !r.isError) return true;
    }
  }
  return false;
}

/** The claim to mark as not confirmed, or null when the reply claims nothing or the work could have done it. */
export function unconfirmedClaim(text: string, steps: Msg[]): string | null {
  const c = claimedAction(text);
  return c && !actedIn(steps) ? c : null;
}
