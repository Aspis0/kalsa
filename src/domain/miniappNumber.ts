// A number a person types into a miniapp input, read the way the interface's
// language writes numbers: "12.500" is 12500 in Italian and 12.5 in English.

/** The decimal mark a language writes numbers with, read off Intl itself:
 *  Italian "1,5" → ",", English "1.5" → ".". */
function decimalMarkOf(tag: string): string {
  try {
    return new Intl.NumberFormat(tag).format(1.5).replace(/[0-9]/g, "").charAt(0) || ".";
  } catch {
    // A tag Intl does not know reads as English.
    return ".";
  }
}

/** The typed text as a number, or NaN when it reads as no number. A lone
 *  separator that is not the language's decimal mark groups when every group
 *  after the first is exactly three digits, and is forgiven as a decimal mark
 *  otherwise ("12.5" stays 12.5 in Italian). */
export function parseLocaleNumber(raw: string, tag: string): number {
  const text = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!/^[+-]?[0-9.,]+$/.test(text) || !/[0-9]/.test(text)) return Number.NaN;
  const decimal = decimalMarkOf(tag);
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both marks: the later one is the decimal mark, the other groups.
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
  if (groups.slice(1).every((part) => /^[0-9]{3}$/.test(part))) return Number(groups.join(""));
  return groups.length === 2 ? Number(text.replace(mark, ".")) : Number.NaN;
}
