/**
 * §5's @Kalsa rule, on the raw text: a message calls the AI when it
 * contains the token `@Kalsa` — the six characters matching
 * ASCII-case-insensitively, no Unicode-alphanumeric character hugging the
 * `@`, and none (nor an underscore) after the final `a`. A letter or digit
 * hugging the token means the `@` belongs to a word or an address, not to
 * a call. The request's call_ai flag is the second way to call and is not
 * this function's business.
 */

const TOKEN = "kalsa";
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

function isUnicodeAlphanumeric(codePoint: number): boolean {
  return ALPHANUMERIC.test(String.fromCodePoint(codePoint));
}

/** The code point ending just before `index`, whole even for astral letters. */
function codePointBefore(text: string, index: number): number | null {
  if (index === 0) return null;
  const last = index - 1;
  const start = (text.charCodeAt(last) & 0xfc00) === 0xdc00 ? last - 1 : last;
  return start < 0 ? null : text.codePointAt(start) ?? null;
}

/** Whether the six characters from `at` are `@kalsa` in ASCII-any case. */
function tokenAt(text: string, at: number): boolean {
  if (text.charCodeAt(at) !== 0x40) return false;
  for (let offset = 0; offset < TOKEN.length; offset += 1) {
    const code = text.charCodeAt(at + 1 + offset);
    if (Number.isNaN(code)) return false;
    const folded = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (folded !== TOKEN.charCodeAt(offset)) return false;
  }
  return true;
}

function callAt(text: string, at: number): boolean {
  const before = codePointBefore(text, at);
  if (before !== null && isUnicodeAlphanumeric(before)) return false;
  const afterIndex = at + 1 + TOKEN.length;
  if (afterIndex < text.length) {
    const after = text.codePointAt(afterIndex);
    if (after === undefined || isUnicodeAlphanumeric(after) || after === 0x5f) return false;
  }
  return true;
}

/** Whether this text contains the token as a call (any occurrence counts). */
export function callsKalsa(text: string): boolean {
  for (let at = 0; at + 1 + TOKEN.length <= text.length; at += 1) {
    if (tokenAt(text, at) && callAt(text, at)) return true;
  }
  return false;
}
