/**
 * One form for a mail's id.
 *
 * The backend reads `u32` and the list remembers its records keyed by the id
 * as text, while models send both `418` and `"418"` — Qwen sends numbers, and
 * an id compared in the shape it arrived in never matches the list. Every id a
 * model gives goes through here, so the comparison is one comparison.
 */

import { unsignedInteger } from "./wholeNumber";

/** The id as the decimal text both sides use, or null when it is not one. */
export function mailId(value: unknown): string | null {
  const number = unsignedInteger(value);
  return number === null ? null : String(number);
}