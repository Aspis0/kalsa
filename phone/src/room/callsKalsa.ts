/**
 * §5's @Kalsa rule, ported from the door's own implementation
 * (kalsa-room/src/mention.rs) so phone and computer draw the same
 * boundary: the six-character token ASCII-case-insensitively, the base
 * character before the `@` — skipping back over combining marks, which
 * belong to the word they decorate — not alphanumeric in Unicode terms,
 * and the character after the final `a` neither alphanumeric, nor an
 * underscore, nor a combining mark. On the raw text, before any
 * processing; the request's call_ai flag is the second way to call and
 * is not this function's business.
 */

const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/** The marks mention.rs hand-lists, range for range: category M a
 *  household keyboard produces, plus the variation selectors. A mark
 *  outside the list leaves the boundary alone — same as the door. */
const MARK =
  /[\u0300-\u036f\u0483-\u0489\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u0730-\u074a\u07a6-\u07b0\u0900-\u0903\u093a-\u094f\u0951-\u0957\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20f0\ufe00-\ufe0f\ufe20-\ufe2f]/u;

const WORD = "kalsa";

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
  for (let offset = 0; offset < WORD.length; offset += 1) {
    const code = text.charCodeAt(at + 1 + offset);
    if (Number.isNaN(code)) return false;
    const folded = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (folded !== WORD.charCodeAt(offset)) return false;
  }
  return true;
}

function callAt(text: string, at: number): boolean {
  // Marks bind to the base they follow: walk past them to the character
  // the boundary rule is actually about. Every listed mark is one UTF-16
  // unit, so each step back is one unit.
  let boundary = at;
  for (;;) {
    const previous = codePointBefore(text, boundary);
    if (previous === null || !MARK.test(String.fromCodePoint(previous))) break;
    boundary -= 1;
  }
  if (boundary > 0) {
    const base = codePointBefore(text, boundary);
    if (base !== null && isUnicodeAlphanumeric(base)) return false;
  }
  const afterIndex = at + 1 + WORD.length;
  if (afterIndex < text.length) {
    const after = text.codePointAt(afterIndex);
    if (
      after !== undefined &&
      (isUnicodeAlphanumeric(after) || after === 0x5f || MARK.test(String.fromCodePoint(after)))
    ) {
      return false;
    }
  }
  return true;
}

/** Whether this text contains the token as a call (any occurrence counts). */
export function callsKalsa(text: string): boolean {
  for (let at = 0; at + 1 + WORD.length <= text.length; at += 1) {
    if (tokenAt(text, at) && callAt(text, at)) return true;
  }
  return false;
}
