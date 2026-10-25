/**
 * A reason code, said in words. The badge on a card is read by the person it
 * warns, so each code becomes one short item in the app's language; a code
 * this build has no words for is dropped rather than shown as itself.
 */

import type { English } from "../../i18n/en/all";

/** The reasons a badge carries, by the code `kalsa-mail` puts on it
    (`label/mod.rs`). The bulk and not_parsed codes are not warning reasons:
    one counts newsletters and the other means a mail was never read at all. */
export function suspiciousReasons(codes: string[]): string[] {
  return codes.filter((code) => code !== "bulk_header" && code !== "bulk_noreply" && code !== "not_parsed");
}

/** One short item per reason, or nothing when nothing about this mail is a
    warning. Kept as items rather than one sentence: run together they read as
    a claim about the mail instead of a list of what tripped the check. */
export function reasonItems(t: English["mail"], codes: string[]): string[] {
  const out: string[] = [];
  for (const code of suspiciousReasons(codes)) {
    const word = t.reasons[code];
    if (typeof word === "string" && word !== "") out.push(word);
  }
  return out;
}