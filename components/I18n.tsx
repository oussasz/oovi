"use client";

// Picks the UI language and hands `t()` to every component.
// Language = the account setting `language` ("auto" follows the system language).
// Settings dispatches `oovi:language` after saving (detail: the new setting) so the
// UI switches at once; without a detail the provider re-reads /api/settings.

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dirOf, intlTag, resolveLocale, setActiveLocale, translate, type Locale, type TKey, type Vars } from "@/lib/i18n";

const STORE = "oovi.language";

type I18n = {
  locale: Locale;
  /** BCP 47 tag for Intl formatting. */
  tag: string;
  dir: "ltr" | "rtl";
  t: (key: TKey, vars?: Vars) => string;
  /** Like t(), but {placeholders} may be React elements (links, bold words). */
  rich: (key: TKey, parts: Record<string, ReactNode>) => ReactNode;
  /** Locale-aware number formatting. */
  num: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** "A, B and C" in the active language. */
  list: (items: string[]) => string;
};

function make(locale: Locale, tag: string): I18n {
  const t = (key: TKey, vars?: Vars) => translate(locale, key, vars, tag);
  return {
    locale,
    tag,
    dir: dirOf(locale),
    t,
    rich: (key, parts) => {
      const out: ReactNode[] = [];
      const template = t(key);
      let last = 0;
      for (const m of template.matchAll(/\{(\w+)\}/g)) {
        const name = m[1] ?? "";
        if (!(name in parts)) continue;
        if (m.index > last) out.push(template.slice(last, m.index));
        out.push(<Fragment key={`${name}-${m.index}`}>{parts[name]}</Fragment>);
        last = m.index + m[0].length;
      }
      if (last < template.length) out.push(template.slice(last));
      return <>{out}</>;
    },
    num: (n, opts) => {
      try {
        return new Intl.NumberFormat(tag, opts).format(n);
      } catch {
        return String(n);
      }
    },
    list: (items) => {
      try {
        return new Intl.ListFormat(tag, { type: "conjunction" }).format(items);
      } catch {
        return items.join(", ");
      }
    },
  };
}

const Ctx = createContext<I18n>(make("en", "en"));

const systemLangs = (): readonly string[] => (typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<string | null>(null);
  const [system, setSystem] = useState<readonly string[]>([]);

  const fetchSetting = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      if (!r.ok) return; // signed out: keep the last known choice
      const s = (await r.json()) as { language?: string };
      const lang = s.language ?? "auto";
      setSetting(lang);
      try {
        localStorage.setItem(STORE, lang);
      } catch {
        /* storage unavailable */
      }
    } catch {
      /* offline or starting up: keep what we have */
    }
  }, []);

  useEffect(() => {
    setSystem(systemLangs());
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) setSetting(saved);
    } catch {
      /* storage unavailable */
    }
    void fetchSetting();

    const onLanguage = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail;
      if (typeof next === "string" && next) {
        setSetting(next);
        try {
          localStorage.setItem(STORE, next);
        } catch {
          /* storage unavailable */
        }
      } else void fetchSetting();
    };
    const onSystem = () => setSystem(systemLangs());
    window.addEventListener("oovi:language", onLanguage);
    window.addEventListener("oovi:account", onLanguage);
    window.addEventListener("languagechange", onSystem);
    return () => {
      window.removeEventListener("oovi:language", onLanguage);
      window.removeEventListener("oovi:account", onLanguage);
      window.removeEventListener("languagechange", onSystem);
    };
  }, [fetchSetting]);

  const locale = resolveLocale(setting ?? "auto", system);
  const tag = intlTag(locale, system);
  const value = useMemo(() => make(locale, tag), [locale, tag]);

  // Keep helpers outside React and the <html> element in step with the UI language.
  setActiveLocale(locale, tag);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = value.dir;
  }, [locale, value.dir]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Everything i18n: { t, rich, num, list, locale, tag, dir }. */
export const useI18n = () => useContext(Ctx);

/** Just the translate function. */
export const useT = () => useContext(Ctx).t;

/** Tell the app the language setting changed (call after saving it). */
export const announceLanguage = (setting?: string) => window.dispatchEvent(new CustomEvent("oovi:language", { detail: setting }));
