// Which language a message is written in, for the few things oovi writes itself (permission cards,
// Telegram notices): they follow the user's latest message, like the bots' replies do.
// Pure: tested in tests/unit/text-locale.test.mts.

/** Common French words (a message needs at least two of them, so English with "a" or "le" doesn't count). */
const FRENCH = new Set(
  "je tu il elle nous vous ils le la les un une des du de est sont pas pour avec mon ma mes ton ta tes son sa ses ce cette qui que quoi où oui non merci bonjour salut fichier fichiers dossier peux peut veux fais fait dans sur aussi mais".split(" "),
);

/** "ar" for Arabic script (Arabic and Darija), "fr" for clear French, null when unsure. */
export function localeOfText(text: string | undefined | null): "ar" | "fr" | null {
  const t = String(text ?? "");
  const arabic = (t.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const latin = (t.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
  if (arabic >= 2 && arabic >= latin / 2) return "ar";
  const words = t.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const fr = words.filter((w) => FRENCH.has(w.replace(/^[a-z]'/, ""))).length;
  if (fr >= 2 || (/[éèêàçù]/.test(t) && fr >= 1)) return "fr";
  return null;
}

/**
 * Algerian Darija written in Latin letters ("3tini la liste ta3 les cafés", "wach t9der tb3tli"): common words,
 * and words that use 2, 3, 5, 7, 9 for Arabic sounds. Two of them make a message Darija, even with French in it.
 */
const DARIJA_LATIN = new Set(
  "wach wech wesh wsh rani rak raki rahi rahom ana nta nti ntouma 3tini a3tini ta3 t3 dyal diali dial kifach kifeh kifah kifash bghit nheb n7eb nhab khdem khdm liya lia lya bzaf bezaf bzzaf sahbi sa7bi khoya khouya kayen kayn makach makanch chhal ch7al 3la 3lah 3lach drok dork dorka derk daba chouf chof mlih mli7 ndir dir nhawes saha sahit sa7it yaatik ya3tik wahran dzayer mazal ghadi rayeh hadi hada hadou nkemmel kemmel zid golili goulili 9olli gotlek goultlek bach besah bessah".split(" "),
);
export function isLatinDarija(text: string | undefined | null): boolean {
  const words = String(text ?? "").toLowerCase().match(/[a-z0-9'à-ÿ]+/g) ?? [];
  const n = words.filter((w) => DARIJA_LATIN.has(w) || (/[a-z]/.test(w) && /[23579]/.test(w) && /^[a-z23579']+$/.test(w) && !/^\d+$/.test(w))).length;
  return n >= 2;
}

const ENGLISH = new Set("the and you your i i'm it is are to of for in on with can please what how this that me my do does not but if".split(" "));

/**
 * The language to write the reply in, said plainly to the bot next to the user's message on every turn.
 * Bots drifted into the language of earlier messages, sources or tables (French answers to an Arabic
 * request). null: not clear enough to say (the general rule in the instructions then applies).
 */
export function replyLanguage(text: string | undefined | null): string | null {
  const l = localeOfText(text);
  if (l === "ar") return "Arabic (if the user wrote in Algerian Darija, Darija is welcome)";
  if (isLatinDarija(text)) return "Darija (Algerian), written in Latin letters like the user writes it (French words are fine where Algerians use them)";
  if (l === "fr") return "French";
  const words = String(text ?? "").toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.filter((w) => ENGLISH.has(w)).length >= 2) return "English";
  return null;
}
