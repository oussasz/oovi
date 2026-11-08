// Tiny typed i18n: flat dictionaries, {name} interpolation, Intl plurals.
// English (en.ts) is the source of truth; missing keys fall back to English.
//
// Add a language: create lib/i18n/xx.ts (copy fr.ts, translate the values), then add
// it to LOCALES, NATIVE_NAMES and DICTS below (and RTL if it's right-to-left).

import ar from "./ar";
import de from "./de";
import en, { type Key } from "./en";
import es from "./es";
import fr from "./fr";
import tr from "./tr";

export type { Key };

export const LOCALES = ["en", "ar", "fr", "es", "de", "tr"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language's name in its own language (for the language picker). */
export const NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  ar: "العربية",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  tr: "Türkçe",
};

const DICTS: Record<Locale, Dict> = { en, ar, fr, es, de, tr };
const RTL: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

/** Base names of plural keys: "side.botCount" for "side.botCount_one" / "_other". */
export type PluralKey = Key extends infer K ? (K extends `${infer B}_other` ? B : never) : never;
export type TKey = Key | PluralKey;
export type Vars = Record<string, string | number>;
/** Every Intl plural category, so languages like Arabic can add forms English doesn't need. */
type PluralForm = `${PluralKey}_${Intl.LDMLPluralRule}`;
/** A translation: any subset of the English keys (plus extra plural forms). */
export type Dict = Partial<Record<Key | PluralForm, string>>;

export const isLocale = (x: unknown): x is Locale => typeof x === "string" && (LOCALES as readonly string[]).includes(x);
export const dirOf = (l: Locale): "rtl" | "ltr" => (RTL.has(l) ? "rtl" : "ltr");

/**
 * Pick the UI language from the account setting ("auto" | "en" | "ar" | …) and the
 * system's preferred languages. Unsupported → English.
 */
export function resolveLocale(setting: string | null | undefined, system: readonly string[] = []): Locale {
  const base = (s: string) => s.toLowerCase().split(/[-_]/)[0] ?? "";
  if (setting && setting !== "auto") {
    const b = base(setting);
    if (isLocale(b)) return b;
  }
  for (const s of system) {
    const b = base(s);
    if (isLocale(b)) return b;
  }
  return "en";
}

/**
 * BCP 47 tag used for Intl (dates, numbers, plurals). Keeps the system's region when it
 * matches the UI language (en-GB dates for a British system). Arabic uses Latin digits
 * so counts match model names, URLs and code shown next to them.
 */
export function intlTag(locale: Locale, system: readonly string[] = []): string {
  const match = system.find((s) => s.toLowerCase().split(/[-_]/)[0] === locale);
  const tag = match && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(match) ? match : locale;
  return locale === "ar" ? `${tag}-u-nu-latn` : tag;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function numberFormat(tag: string): Intl.NumberFormat {
  let f = numberFormats.get(tag);
  if (!f) {
    try {
      f = new Intl.NumberFormat(tag);
    } catch {
      f = new Intl.NumberFormat("en");
    }
    numberFormats.set(tag, f);
  }
  return f;
}

function pluralRule(tag: string): Intl.PluralRules {
  let r = pluralRules.get(tag);
  if (!r) {
    try {
      r = new Intl.PluralRules(tag);
    } catch {
      r = new Intl.PluralRules("en");
    }
    pluralRules.set(tag, r);
  }
  return r;
}

function lookup(locale: Locale, key: string): string | undefined {
  return (DICTS[locale] as Record<string, string | undefined>)[key] ?? (en as Record<string, string | undefined>)[key];
}

/** Translate `key` for `locale`, filling {vars}. Numbers are formatted for the locale. */
export function translate(locale: Locale, key: TKey, vars?: Vars, tag: string = intlTag(locale)): string {
  let template: string | undefined;
  const count = vars?.count;
  if (typeof count === "number") {
    const cat = pluralRule(tag).select(count);
    template = lookup(locale, `${key}_${cat}`) ?? lookup(locale, `${key}_other`);
  }
  template ??= lookup(locale, key) ?? key;
  if (!vars) return template;
  const nf = numberFormat(tag);
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    if (v === undefined) return m;
    return typeof v === "number" ? nf.format(v) : v;
  });
}

// The language the UI is showing right now, for helpers outside React (lib/client.ts).
let active: { locale: Locale; tag: string } = { locale: "en", tag: "en" };

export function setActiveLocale(locale: Locale, tag: string = intlTag(locale)) {
  active = { locale, tag };
}
export const activeLocale = () => active.locale;
export const activeTag = () => active.tag;

/** Translate with the active UI language (for code outside components). */
export const t = (key: TKey, vars?: Vars) => translate(active.locale, key, vars, active.tag);
