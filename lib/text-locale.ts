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
