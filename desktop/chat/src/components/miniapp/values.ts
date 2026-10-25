/**
 * The coercions the miniapp block renderers share: a block arrives as an
 * open record, so every reader takes text, numbers and lists the same way.
 * Ported from the phone renderer's helpers.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asArray(value: unknown, maxItems: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The decimal separator a language writes numbers with, read off Intl
 *  itself: Italian "1,5" → ",", English "1.5" → ".". */
function decimalSeparatorOf(tag: string): string {
  try {
    return new Intl.NumberFormat(tag).format(1.5).replace(/[0-9]/g, "").charAt(0) || ".";
  } catch {
    // A tag Intl does not know falls back to the dot.
  }
  return ".";
}

/** One typed value as a number, read the way the interface's language writes
 *  numbers: "12.500" is 12500 in Italian and 12.5 in English; "1.234,5" is
 *  1234.5 in Italian, "1,234.5" the same in English. A lone separator that
 *  is not the language's decimal mark reads as grouping when it groups
 *  exactly (threes) and as a decimal mark when it does not ("12.5" in
 *  Italian stays 12.5). NaN when it reads as no number at all. */
export function parseLocaleNumber(raw: string, tag: string): number {
  const text = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!/^[+-]?[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return Number.NaN;
  const decimal = decimalSeparatorOf(tag);
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both kinds: the later one is the decimal mark, the other is grouping.
    const decimalAt = Math.max(lastComma, lastDot);
    const grouping = text[decimalAt] === "," ? "." : ",";
    const integer = text.slice(0, decimalAt).split(grouping).join("");
    const fraction = text.slice(decimalAt + 1).split(grouping).join("");
    return Number(`${integer}.${fraction}`);
  }
  if (lastComma === -1 && lastDot === -1) return Number(text);
  const mark = lastComma !== -1 ? "," : ".";
  const groups = text.split(mark);
  if (mark === decimal && groups.length === 2) return Number(text.replace(mark, "."));
  // The mark groups when every group after the first is exactly three digits,
  // even when the same mark repeats ("1.234.567"); otherwise a lone mark is
  // forgiven as a decimal ("12.5" in Italian) or reads as no number.
  if (groups.slice(1).every((part) => /^[0-9]{3}$/.test(part))) return Number(groups.join(""));
  return groups.length === 2 ? Number(text.replace(mark, ".")) : Number.NaN;
}

/** A number as the interface's language writes it — decimal comma in it/es/fr,
 *  grouping where the language groups — or "--" when it is not a number. */
export function formatNumber(value: unknown, tag: string, digits = 3): string {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return "--";
  try {
    return new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(parsed);
  } catch {
    // A tag Intl does not know falls back to the plain form.
    return Number(parsed.toFixed(digits)).toString();
  }
}
