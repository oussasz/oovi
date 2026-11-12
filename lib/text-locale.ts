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

const ENGLISH = new Set("the and you your i i'm it is are to of for in on with can please what how this that me my do does not but if".split(" "));

/**
 * The language to write the reply in, said plainly to the bot next to the user's message on every turn.
 * Bots drifted into the language of earlier messages, sources or tables (French answers to an Arabic
 * request). null: not clear enough to say (the general rule in the instructions then applies).
 */
export function replyLanguage(text: string | undefined | null): string | null {
  const l = localeOfText(text);
  if (l === "ar") return "Arabic (if the user wrote in Algerian Darija, Darija is welcome)";
  if (l === "fr") return "French";
  const words = String(text ?? "").toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.filter((w) => ENGLISH.has(w)).length >= 2) return "English";
  return null;
}
