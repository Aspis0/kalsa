import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { en } from "./en";
import { it } from "./it";
import type { Locale, LocaleStrings } from "./types";

export type { Locale, LocaleStrings };
export { en, it };

export const LOCALE_KEY = "kalsa.locale";
export const DEFAULT_LOCALE: Locale = "en";

const CATALOG: Record<Locale, LocaleStrings> = { en, it };

/** Nested string leaf keys of the locale catalog, e.g. "chat.placeholder". */
export type DeepKeyOf<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? DeepKeyOf<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type TranslationKey = DeepKeyOf<LocaleStrings>;

type TranslateParams = Record<string, string | number>;

/** Flatten nested catalog once per locale for O(1) key lookup. */
function flattenCatalog(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object") {
      Object.assign(out, flattenCatalog(value, path));
    }
  }
  return out;
}

const FLAT_CATALOG: Record<Locale, Record<string, string>> = {
  en: flattenCatalog(en),
  it: flattenCatalog(it),
};

function applyParams(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

/** Resolve strings for a locale (non-React modules). */
export function getStrings(locale: Locale): LocaleStrings {
  return CATALOG[locale] ?? en;
}

/** Translate a nested key for a given locale. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const flat = FLAT_CATALOG[locale] ?? FLAT_CATALOG.en;
  const value = flat[key] ?? FLAT_CATALOG.en[key];
  if (typeof value !== "string") return key;
  return applyParams(value, params);
}

/** Build a bound `t` function for a locale (non-React modules). */
export function makeT(locale: Locale) {
  return (key: TranslationKey, params?: TranslateParams) => translate(locale, key, params);
}

export type TranslateFn = ReturnType<typeof makeT>;

function parseLocale(raw: string | null | undefined): Locale {
  return raw === "it" ? "it" : "en";
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TranslateFn;
  ready: boolean;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** App-wide locale provider (AsyncStorage-backed). */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(LOCALE_KEY)
      .then((saved) => {
        if (!mounted) return;
        setLocaleState(parseLocale(saved));
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    const normalized = parseLocale(next);
    setLocaleState(normalized);
    AsyncStorage.setItem(LOCALE_KEY, normalized).catch(() => undefined);
  }, []);

  const t = useMemo(() => makeT(locale), [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, ready }),
    [locale, ready, setLocale, t],
  );

  return React.createElement(LocaleContext.Provider, { value }, children);
}

/**
 * React hook: shared locale from LocaleProvider.
 * Falls back to English defaults if used outside the provider (safe for tests).
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  const fallbackT = useMemo(() => makeT(DEFAULT_LOCALE), []);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => undefined,
    t: fallbackT,
    ready: true,
  };
}
