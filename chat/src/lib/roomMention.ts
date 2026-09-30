// The @Kalsa call rule, mirrored from the Rust matcher
// (crates/kalsa-room/src/mention.rs) character for character: same
// boundary rule, same mark walk, same script set. The two must never
// drift — the smoke bench runs the same vectors the Rust tests run, and
// the backend's own derivation (`call_ai = flag || calls_ai`) stays the
// authority for whether a call actually happened; this mirror only
// highlights.

/** Combining marks (Unicode category M), hand-listed like the Rust
    is_mark's ranges cover: the common diacriticals of Latin, Cyrillic,
    Hebrew, Arabic, Devanagari and Thai, plus variation selectors. */
function isMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x0483 && code <= 0x0489) ||
    (code >= 0x0591 && code <= 0x05c7) ||
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x0730 && code <= 0x074a) ||
    (code >= 0x07a6 && code <= 0x07b0) ||
    (code >= 0x0900 && code <= 0x0903) ||
    (code >= 0x093a && code <= 0x094f) ||
    (code >= 0x0951 && code <= 0x0957) ||
    code === 0x0e31 ||
    (code >= 0x0e34 && code <= 0x0e3a) ||
    (code >= 0x0e47 && code <= 0x0e4e) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20f0) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

/** The scripts that write email addresses and handles: a letter of these
    — or a digit — hugging the token means the `@` belongs to a word. Han,
    kana, hangul and CJK punctuation do not join: "请问@Kalsa" calls. */
function isScriptLetter(c: string): boolean {
  const code = c.codePointAt(0) ?? 0;
  const latin =
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7);
  const cyrillic = code >= 0x0400 && code <= 0x052f;
  const greek = (code >= 0x0370 && code <= 0x03ff) || (code >= 0x1f00 && code <= 0x1fff);
  return latin || cyrillic || greek;
}

function isDigit(c: string): boolean {
  return /\p{Nd}/u.test(c);
}

function blocksBefore(c: string): boolean {
  return isScriptLetter(c) || isDigit(c);
}

function blocksAfter(c: string): boolean {
  return isScriptLetter(c) || isDigit(c) || c === "_" || isMark(c.codePointAt(0) ?? 0);
}

/** Whether `text` calls the AI: the six-character token `@Kalsa`, matched
    ASCII-case-insensitively, at a boundary — marks before the `@` are
    skipped back to their base, and marks after the word count as part of
    it. "café@Kalsa" (NFC or NFD) is an address; "请问@Kalsa" and
    "@Kalsa你好" call; "@Kalsabot" does not. */
export function callsAi(text: string): boolean {
  const WORD = ["k", "a", "l", "s", "a"];
  const chars = Array.from(text);
  for (let start = 0; start < chars.length; start++) {
    const end = start + 6;
    if (end > chars.length || chars[start] !== "@") continue;
    let matched = true;
    for (let i = 0; i < 5; i++) {
      if (chars[start + 1 + i].toLowerCase() !== WORD[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    let before = start;
    while (before > 0 && isMark(chars[before - 1].codePointAt(0) ?? 0)) {
      before -= 1;
    }
    const beforeOk = before === 0 || !blocksBefore(chars[before - 1]);
    const after = chars[end];
    const afterOk = after === undefined || (!blocksAfter(after) && !isMark(after.codePointAt(0) ?? 0));
    if (beforeOk && afterOk) return true;
  }
  return false;
}
