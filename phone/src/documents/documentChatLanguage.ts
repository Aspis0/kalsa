import type { Locale } from "../i18n/types";

export function buildAnswerLanguageCue(locale: Locale): string {
  return (
    `Answer in the language of the user's question (if unclear, ` +
    `${locale === "it" ? "Italian" : "English"}). ` +
    `Quote passages in their original language.`
  );
}
