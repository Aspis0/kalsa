/**
 * Compact operative block for chat turns (language / web_search / honesty / miniapp).
 * Same text for all placement formats — only position in the message list changes.
 * `summary` is reserved for later phases (null for now).
 */

import { getStrings, type Locale } from "../i18n";

/**
 * Build the operative instruction block in the settings language.
 * @param locale Settings locale ("en" | "it")
 * @param summary Optional conversation summary (null until later phases)
 */
export function buildOperativeBlock(
  locale: Locale,
  summary: string | null,
): string {
  const s = getStrings(locale).operativeBlock;
  const parts = [s.language, s.webSearch, s.honesty, s.miniapp];
  if (summary && summary.trim().length > 0) {
    parts.push(s.summary.replace("{summary}", summary.trim()));
  }
  return parts.join(" ");
}
