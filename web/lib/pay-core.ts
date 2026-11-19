// Paying from inside the app (docs/CLOUD-BUILD.md, owner 2026-11-19): the pure parts. The app asks the website for
// a short-lived, single-use link tied to the signed-in account and opens it in the browser; no website sign-in.
// Tested in tests/unit/pay.test.mts (no local imports here).

/** A payment link works once, for 10 minutes. */
export const PAY_LINK_SECONDS = 600;
/** Links made per account in 10 minutes (each press of Upgrade makes one). */
export const MAX_LINKS_PER_WINDOW = 10;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type PayKind = "checkout" | "portal";
export type LinkRequest = { kind: "checkout"; priceId: string | null } | { kind: "portal" };

/**
 * POST /api/v1/billing/link body: {kind:"checkout", plan?, cycle?, priceId?} or {kind:"portal"}. A plan or price
 * must be one the site sells (`prices`: plan id → {month, year}); none = the page shows the plans to choose from.
 */
export function checkLinkRequest(body: unknown, prices: Record<string, { month: string; year: string }>): LinkRequest | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid request.";
  const b = body as Record<string, unknown>;
  if (b.kind === "portal") return { kind: "portal" };
  if (b.kind !== "checkout") return "kind must be checkout or portal.";
  if (b.credits !== undefined) return "Credit packs aren't sold yet: choose a plan.";
  const all = new Set(Object.values(prices).flatMap((p) => [p.month, p.year]));
  if (typeof b.priceId === "string") return all.has(b.priceId) ? { kind: "checkout", priceId: b.priceId } : "Unknown price.";
  if (b.plan === undefined || b.plan === null) return { kind: "checkout", priceId: null };
  if (typeof b.plan !== "string" || !prices[b.plan]) return "Unknown plan.";
  const cycle = b.cycle === undefined ? "month" : b.cycle;
  if (cycle !== "month" && cycle !== "year") return "cycle must be month or year.";
  return { kind: "checkout", priceId: prices[b.plan]![cycle] };
}

export type PayLang = "ar" | "fr" | "en";
export function payLang(acceptLanguage: string | null): PayLang {
  for (const part of (acceptLanguage ?? "").toLowerCase().split(",")) {
    const tag = part.trim().slice(0, 2);
    if (tag === "ar" || tag === "fr" || tag === "en") return tag;
  }
  return "en";
}

/** The words of the payment pages, in the person's language. */
export const PAY_TEXT: Record<PayLang, Record<"goneTitle" | "gone" | "doneTitle" | "done" | "noSubTitle" | "noSub" | "offTitle" | "off" | "checkoutTitle" | "checkoutLead", string>> = {
  en: {
    goneTitle: "This payment link has expired",
    gone: "Payment links work once, for 10 minutes. Open oovi and press Subscribe again.",
    doneTitle: "Thank you!",
    done: "Your payment went through. Go back to oovi: your plan and credits appear in a moment.",
    noSubTitle: "No subscription yet",
    noSub: "This account has no subscription to manage. Open oovi and press Subscribe to choose a plan.",
    offTitle: "Payments aren't available right now",
    off: "Please try again later, or write to contact@conuron.com.",
    checkoutTitle: "Choose your plan",
    checkoutLead: "Paying for the oovi account {email}. Your credits are added to it as soon as the payment goes through.",
  },
  fr: {
    goneTitle: "Ce lien de paiement a expiré",
    gone: "Un lien de paiement ne marche qu'une fois, pendant 10 minutes. Ouvrez oovi et appuyez de nouveau sur « S'abonner ».",
    doneTitle: "Merci !",
    done: "Votre paiement est passé. Retournez dans oovi : votre offre et vos crédits apparaissent dans un instant.",
    noSubTitle: "Pas encore d'abonnement",
    noSub: "Ce compte n'a pas d'abonnement à gérer. Ouvrez oovi et appuyez sur « S'abonner » pour choisir une offre.",
    offTitle: "Les paiements ne sont pas disponibles pour le moment",
    off: "Réessayez plus tard, ou écrivez à contact@conuron.com.",
    checkoutTitle: "Choisissez votre offre",
    checkoutLead: "Paiement pour le compte oovi {email}. Vos crédits y sont ajoutés dès que le paiement passe.",
  },
  ar: {
    goneTitle: "انتهت صلاحية رابط الدفع هذا",
    gone: "رابط الدفع يعمل مرة واحدة فقط ولمدة 10 دقائق. افتح oovi واضغط على «اشترك» من جديد.",
    doneTitle: "شكرًا لك!",
    done: "تمّ الدفع. ارجع إلى oovi: ستظهر خطتك ورصيدك خلال لحظات.",
    noSubTitle: "لا يوجد اشتراك بعد",
    noSub: "لا يوجد في هذا الحساب اشتراك لإدارته. افتح oovi واضغط على «اشترك» لاختيار خطة.",
    offTitle: "الدفع غير متاح حاليًا",
    off: "حاول لاحقًا، أو راسلنا على contact@conuron.com.",
    checkoutTitle: "اختر خطتك",
    checkoutLead: "الدفع لحساب oovi ‏{email}. يُضاف رصيدك إليه فور نجاح الدفع.",
  },
};
