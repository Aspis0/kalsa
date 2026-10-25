// The @Kalsa call rule, mirrored from the Rust matcher
// (crates/kalsa-room/src/mention.rs) property for property: marks are
// category M, letters ask Alphabetic first, and the token's letters
// lowercase ASCII-only. The smoke bench runs the same vectors the Rust
// tests run, and the backend's own derivation (`call_ai = flag ||
// calls_ai`) stays the authority for whether a call actually happened;
// this mirror only highlights.

function isMark(c: string): boolean {
  return /\p{M}/u.test(c);
}

function isDigit(c: string): boolean {
  return /\p{Nd}/u.test(c);
}

function isAlphabetic(c: string): boolean {
  return /\p{Alphabetic}/u.test(c);
}

function isScriptLetter(c: string): boolean {
  const code = c.codePointAt(0) ?? 0;
  const latin =
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7);
  const cyrillic = code >= 0x0400 && code <= 0x052f;
  const greek = (code >= 0x0370 && code <= 0x03ff) || (code >= 0x1f00 && code <= 0x1fff);
  return isAlphabetic(c) && (latin || cyrillic || greek);
}

function blocksBefore(c: string): boolean {
  return isScriptLetter(c) || isDigit(c);
}

function blocksAfter(c: string): boolean {
  return isScriptLetter(c) || isDigit(c) || c === "_" || isMark(c);
}

/** Where the token `@Kalsa` stands, ASCII-case-insensitively, when it
    calls: the six characters must match, the base character before the
    `@` (marks skipped) must not be a Latin, Greek or Cyrillic letter or a
    digit, and the character after the final `a` must be none of those,
    `_`, or a mark. Null when nothing calls. */
export function callsAiAt(text: string): number | null {
  const WORD = ["k", "a", "l", "s", "a"];
  const chars = Array.from(text);
  for (let start = 0; start < chars.length; start++) {
    const end = start + 6;
    if (end > chars.length || chars[start] !== "@") continue;
    let matched = true;
    for (let i = 0; i < 5; i++) {
      // ASCII-only lowering, like the Rust compare: the Kelvin sign is
      // not a k.
      if (chars[start + 1 + i] !== WORD[i] && chars[start + 1 + i] !== WORD[i].toUpperCase()) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    let before = start;
    while (before > 0 && isMark(chars[before - 1])) {
      before -= 1;
    }
    const beforeOk = before === 0 || !blocksBefore(chars[before - 1]);
    const after = chars[end];
    const afterOk = after === undefined || !blocksAfter(after);
    if (beforeOk && afterOk) return start;
  }
  return null;
}

/** Whether `text` calls the AI. */
export function callsAi(text: string): boolean {
  return callsAiAt(text) !== null;
}

/** One message's text, with the calling token highlighted where the
    matcher found it. */
export function RoomText({ text }: { text: string }) {
  const at = callsAiAt(text);
  if (at === null) return <span className="room-text">{text}</span>;
  const tokenStart = text.indexOf("@", at);
  return (
    <span className="room-text">
      {text.slice(0, tokenStart)}
      <span className="room-mention">{text.slice(tokenStart, tokenStart + 6)}</span>
      {text.slice(tokenStart + 6)}
    </span>
  );
}
