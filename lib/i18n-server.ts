// Translations for text oovi sends without a page around it (notifications, Telegram, reports in a chat):
// the app's UI language (Settings > Language; "auto" = this computer's).
import { intlTag, resolveLocale, translate, type TKey, type Vars } from "./i18n";
import { loadSettings } from "./settings";

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
