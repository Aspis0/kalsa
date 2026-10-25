// The app's five languages. English is the source the others are checked
// against: every language's table is typed as the English shape, so a
// missing key fails `tsc` and an extra one is a type error too.

export const LANGUAGES = ["en", "it", "es", "fr", "zh"] as const;

export type Language = (typeof LANGUAGES)[number];

export interface LanguageOption {
  code: Language;
  /** Its own name for itself, shown in the Settings row. */
  ownName: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", ownName: "English" },
  { code: "it", ownName: "Italiano" },
  { code: "es", ownName: "Español" },
  { code: "fr", ownName: "Français" },
  { code: "zh", ownName: "简体中文" },
];

/** The system's best language among the five: the first `navigator`
    language that maps to one, else English. zh-Hant (zh-TW, zh-HK,
    zh-Hant) is not shipped, so it reads as English rather than half a
    language. */
export function systemLanguage(): Language {
  const available = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const tag of available) {
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (lower.startsWith("zh")) {
      if (lower.includes("tw") || lower.includes("hk") || lower.includes("hant")) return "en";
      return "zh";
    }
    const two = lower.slice(0, 2);
    if (two === "en" || two === "it" || two === "es" || two === "fr") return two;
  }
  return "en";
}

import { ENGLISH } from "./en/all";
import { ITALIAN } from "./it/all";
import { SPANISH } from "./es/all";
import { FRENCH } from "./fr/all";
import { CHINESE } from "./zh/all";

export type Table = typeof ENGLISH;

/** Every language's table, by code — the parity check and the hook both
    read this one record. */
export const TABLES: Record<Language, Table> = {
  en: ENGLISH,
  it: ITALIAN,
  es: SPANISH,
  fr: FRENCH,
  zh: CHINESE,
};
