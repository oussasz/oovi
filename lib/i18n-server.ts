// Translations for text oovi sends without a page around it (notifications, Telegram, reports in a chat):
// the app's UI language (Settings > Language; "auto" = this computer's).
import { intlTag, resolveLocale, translate, type TKey, type Vars } from "./i18n";
import { loadSettings } from "./settings";
import { localeOfText } from "./text-locale";

export function translateFor(key: TKey, vars?: Vars): string {
  let system: string[] = [];
  try {
    system = [Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    system = [];
  }
  let setting = "auto";
  try {
    setting = loadSettings().language || "auto";
  } catch {
    setting = "auto";
  }
  const locale = resolveLocale(setting, system);
  return translate(locale, key, vars, intlTag(locale, system));
}

export type Tr = (key: TKey, vars?: Vars) => string;

/**
 * A translator for text oovi writes to the user about a conversation (permission cards, Telegram notices):
 * the language of the user's latest message when it's clear (Arabic/Darija, French), else the app's.
 */
export function translatorFor(userText?: string | null): Tr {
  const fromText = localeOfText(userText);
  if (!fromText) return translateFor;
  return (key, vars) => translate(fromText, key, vars, intlTag(fromText, []));
}
