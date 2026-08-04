/**
 * Dependency-free markdown subset parser for assistant chat messages.
 *
 * Streaming-safe: unclosed inline markers render as literal text; complete
 * constructs only consume their delimiters. O(n) left-to-right scan.
 *
 * Fenced code blocks are handled upstream (AiChatPage segment splitter).
 *
 * Emphasis uses CommonMark flanking rules for `*` and the stricter `_` rule
 * (no intraword underscore emphasis). Backslash escapes are honored for the
 * punctuation this parser understands.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  /** Numeric citation marker like `[2]`. `text` is the literal source (`"[2]"`). */
  | { type: "citation"; index: number; text: string };

export type MdBlock =
  | { type: "paragraph"; inline: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; inline: InlineNode[] }
  | { type: "listItem"; ordered: boolean; marker: string; depth: number; inline: InlineNode[] }
  | { type: "quote"; inline: InlineNode[] }
  | { type: "rule" };

/**
 * URL scheme gate — single implementation lives in `src/util/url.ts`.
 * Re-exported here so existing chat/markdown consumers keep working.
 */
export { isSafeHttpUrl } from "../util/url";

/** Concatenate plain text of every inline node (rules contribute nothing). */
export function flattenBlockText(blocks: MdBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (b.type === "rule") continue;
    for (const n of b.inline) {
      out += n.text;
    }
  }
  return out;
}

/**
 * Parse a non-fenced markdown string into a flat block list.
 * One non-empty line → one block (blank lines are structural only).
 */
export function parseMarkdownBlocks(src: string): MdBlock[] {
  if (!src) return [];

  const blocks: MdBlock[] = [];
  // Split on \n; tolerate \r\n by stripping trailing \r from each line.
  const lines = src.split("\n");

  for (let li = 0; li < lines.length; li++) {
    let line = lines[li]!;
    if (line.endsWith("\r")) line = line.slice(0, -1);

    // Blank line: no block (paragraph break / structure).
    if (line.length === 0) continue;

    // Horizontal rule: --- / *** / ___ on its own line (optional surrounding spaces).
    if (isHorizontalRule(line)) {
      blocks.push({ type: "rule" });
      continue;
    }

    // Heading: # ## ### (deeper → level 3). Requires space after hashes.
    const heading = matchHeading(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading.level,
        inline: parseInline(heading.content),
      });
      continue;
    }

    // Blockquote: >
    const quote = matchQuote(line);
    if (quote !== null) {
      blocks.push({ type: "quote", inline: parseInline(quote) });
      continue;
    }

    // List item (unordered / ordered), with optional leading indent → depth 0|1.
    const list = matchListItem(line);
    if (list) {
      blocks.push({
        type: "listItem",
        ordered: list.ordered,
        marker: list.marker,
        depth: list.depth,
        inline: parseInline(list.content),
      });
      continue;
    }

    // Default: paragraph
    blocks.push({ type: "paragraph", inline: parseInline(line) });
  }

  return blocks;
}

// ── Block matchers ──────────────────────────────────────────────────────────

function isHorizontalRule(line: string): boolean {
  const t = trimAsciiSpaces(line);
  if (t.length < 3) return false;
  const c = t[0];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== c) return false;
  }
  return true;
}

function matchHeading(line: string): { level: 1 | 2 | 3; content: string } | null {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === "#") hashes++;
  if (hashes === 0 || hashes > 6) return null;
  // Require at least one space/tab after hashes (CommonMark-ish).
  if (line[hashes] !== " " && line[hashes] !== "\t") return null;
  let i = hashes;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  const level = Math.min(3, hashes) as 1 | 2 | 3;
  return { level, content: line.slice(i) };
}

function matchQuote(line: string): string | null {
  // Optional leading spaces then >
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  // Allow a little indent but treat pure quote at line start-ish
  if (i > 3) return null;
  if (line[i] !== ">") return null;
  i++;
  if (line[i] === " " || line[i] === "\t") i++;
  return line.slice(i);
}

function matchListItem(
  line: string,
): { ordered: boolean; marker: string; depth: number; content: string } | null {
  let i = 0;
  while (i < line.length && line[i] === " ") i++;
  // Tabs count as indent too
  let tabIndent = 0;
  if (i === 0) {
    while (i < line.length && line[i] === "\t") {
      tabIndent++;
      i++;
    }
  }
  const spaces = i;
  // depth: 0 or 1 (2+ spaces or any tab → depth 1; deeper clamps to 1)
  const depth = spaces >= 2 || tabIndent >= 1 ? 1 : 0;

  if (i >= line.length) return null;

  // Unordered: - * + followed by space
  const ch = line[i]!;
  if (ch === "-" || ch === "*" || ch === "+") {
    const next = line[i + 1];
    if (next === " " || next === "\t") {
      // Not a horizontal rule line (those are handled earlier), and not ** etc.
      // Reject if this looks like emphasis start without list space — we require space.
      let j = i + 1;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      return {
        ordered: false,
        marker: ch,
        depth,
        content: line.slice(j),
      };
    }
  }

  // Ordered: 1. or 2) etc.
  if (ch >= "0" && ch <= "9") {
    let j = i;
    while (j < line.length && line[j]! >= "0" && line[j]! <= "9") j++;
    if (j > i && j < line.length && (line[j] === "." || line[j] === ")")) {
      const punct = line[j]!;
      const num = line.slice(i, j);
      j++;
      if (line[j] === " " || line[j] === "\t") {
        while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
        return {
          ordered: true,
          marker: `${num}${punct}`,
          depth,
          content: line.slice(j),
        };
      }
    }
  }

  return null;
}

function trimAsciiSpaces(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === " " || s[a] === "\t")) a++;
  while (b > a && (s[b - 1] === " " || s[b - 1] === "\t")) b--;
  return s.slice(a, b);
}

// ── Escapes & flanking (CommonMark-inspired) ────────────────────────────────

/** Punctuation this parser can backslash-escape (CommonMark subset we understand). */
const ESCAPABLE = new Set(["*", "_", "`", "[", "]", "(", ")", "#", ">", "\\"]);

function isEscapable(ch: string): boolean {
  return ESCAPABLE.has(ch);
}

function isUnicodeWhitespace(ch: string | undefined): boolean {
  // Edges of the string act as whitespace for flanking.
  if (ch === undefined) return true;
  const c = ch.charCodeAt(0);
  // ASCII whitespace + NBSP + line/paragraph separators commonly treated as ws
  return (
    c === 0x20 ||
    c === 0x09 ||
    c === 0x0a ||
    c === 0x0b ||
    c === 0x0c ||
    c === 0x0d ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** ASCII punctuation (CommonMark core set used for flanking). */
function isPunctuation(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

type Flank = {
  leftFlanking: boolean;
  rightFlanking: boolean;
  beforePunct: boolean;
  afterPunct: boolean;
};

/**
 * CommonMark left/right flanking for a delimiter run [runStart, runEnd).
 * Edges of the string count as whitespace.
 */
function classifyFlanking(s: string, runStart: number, runEnd: number): Flank {
  const before = runStart > 0 ? s[runStart - 1] : undefined;
  const after = runEnd < s.length ? s[runEnd] : undefined;
  const beforeWs = isUnicodeWhitespace(before);
  const afterWs = isUnicodeWhitespace(after);
  const beforePunct = !beforeWs && isPunctuation(before);
  const afterPunct = !afterWs && isPunctuation(after);

  // Left-flanking: not followed by whitespace, and either not followed by
  // punctuation, or followed by punctuation and preceded by whitespace/punct.
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  // Right-flanking: mirror.
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);

  return { leftFlanking, rightFlanking, beforePunct, afterPunct };
}

function canOpenStar(fl: Flank): boolean {
  return fl.leftFlanking;
}

function canCloseStar(fl: Flank): boolean {
  return fl.rightFlanking;
}

/** Stricter CommonMark `_` open: left-flanking AND (not right-flanking OR preceded by punct). */
function canOpenUnderscore(fl: Flank): boolean {
  return fl.leftFlanking && (!fl.rightFlanking || fl.beforePunct);
}

/** Stricter CommonMark `_` close: right-flanking AND (not left-flanking OR followed by punct). */
function canCloseUnderscore(fl: Flank): boolean {
  return fl.rightFlanking && (!fl.leftFlanking || fl.afterPunct);
}

// ── Inline parser (single left-to-right scan, O(n)) ─────────────────────────

/**
 * Parse inline markdown. Unclosed delimiters are emitted as literal text —
 * never dropped, never partially styled.
 *
 * Link `]` lookup is O(1) via a once-per-line next-`]` table so repeated
 * unclosed `[` stays linear overall.
 */
export function parseInline(src: string): InlineNode[] {
  if (!src) return [];

  const nodes: InlineNode[] = [];
  let buf = "";
  let i = 0;
  const n = src.length;

  // Precompute next `]` at-or-after each index (inclusive). Built once in O(n)
  // so tryParseLink never re-scans the tail for every unclosed `[`.
  const nextBracket = new Int32Array(n + 1);
  nextBracket[n] = -1;
  let nextRb = -1;
  for (let k = n - 1; k >= 0; k--) {
    if (src[k] === "]") nextRb = k;
    nextBracket[k] = nextRb;
  }

  const flush = () => {
    if (buf.length > 0) {
      nodes.push({ type: "text", text: buf });
      buf = "";
    }
  };

  while (i < n) {
    const c = src[i]!;

    // Backslash escape: consume `\`, emit next char as literal (never delimiter).
    if (c === "\\" && i + 1 < n && isEscapable(src[i + 1]!)) {
      buf += src[i + 1]!;
      i += 2;
      continue;
    }

    // Inline code: `...` (closing backtick must be unescaped)
    if (c === "`") {
      const close = indexOfUnescaped(src, "`", i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ type: "code", text: src.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buf += "`";
      i += 1;
      continue;
    }

    // Triple-star bold: ***...*** (flat bold; no stray leading `*` in payload)
    if (c === "*" && src[i + 1] === "*" && src[i + 2] === "*") {
      const openFl = classifyFlanking(src, i, i + 3);
      if (canOpenStar(openFl)) {
        const close = findStarRunClose(src, i + 3, 3);
        if (close !== -1) {
          flush();
          nodes.push({ type: "bold", text: src.slice(i + 3, close) });
          i = close + 3;
          continue;
        }
      }
      // Cannot open or no closer: fall through to ** / * handling below.
    }

    // Bold: **...**
    if (c === "*" && src[i + 1] === "*") {
      const openFl = classifyFlanking(src, i, i + 2);
      if (canOpenStar(openFl)) {
        const close = findStarRunClose(src, i + 2, 2);
        if (close !== -1) {
          flush();
          nodes.push({ type: "bold", text: src.slice(i + 2, close) });
          i = close + 2;
          continue;
        }
      }
      buf += "**";
      i += 2;
      continue;
    }

    // Italic: *...* (single star; flanking required)
    if (c === "*") {
      const openFl = classifyFlanking(src, i, i + 1);
      if (canOpenStar(openFl)) {
        const close = findSingleStarClose(src, i + 1);
        if (close !== -1) {
          flush();
          nodes.push({ type: "italic", text: src.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }
      buf += "*";
      i += 1;
      continue;
    }

    // Italic: _..._ (stricter flanking + first `_` must be a valid closer so
    // identifier-like `_snake_case_` stays fully literal)
    if (c === "_") {
      const openFl = classifyFlanking(src, i, i + 1);
      if (canOpenUnderscore(openFl)) {
        const close = findUnderscoreClose(src, i + 1);
        if (close !== -1) {
          flush();
          nodes.push({ type: "italic", text: src.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
      }
      buf += "_";
      i += 1;
      continue;
    }

    // Link: [text](url) with optional title; O(1) `]` via nextBracket table.
    // Links win over citations: `[1](https://…)` is always a link.
    if (c === "[") {
      const link = tryParseLink(src, i, nextBracket);
      if (link) {
        flush();
        nodes.push({ type: "link", text: link.text, href: link.href });
        i = link.end;
        continue;
      }
      // Citation: `[` + ASCII digits + `]` not immediately followed by `(`.
      // Pure parser: records the number only; renderer decides chip vs literal.
      const citation = tryParseCitation(src, i);
      if (citation) {
        flush();
        nodes.push({
          type: "citation",
          index: citation.index,
          text: citation.text,
        });
        i = citation.end;
        continue;
      }
      buf += "[";
      i += 1;
      continue;
    }

    buf += c;
    i += 1;
  }

  flush();
  return nodes;
}

/**
 * Find unescaped `ch` at or after `from`. A preceding odd-length run of
 * backslashes escapes the character (CommonMark).
 */
function indexOfUnescaped(s: string, ch: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] !== ch) continue;
    // Count consecutive backslashes immediately before i
    let bs = 0;
    for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
    if (bs % 2 === 1) continue; // escaped
    return i;
  }
  return -1;
}

/**
 * Find a closing star run of exactly `runLen` that is right-flanking, starting
 * search at `from`. Skips escaped stars. Returns start index of the close run
 * or -1.
 */
function findStarRunClose(s: string, from: number, runLen: number): number {
  for (let i = from; i <= s.length - runLen; i++) {
    // Skip escaped char (backslash + escapable)
    if (s[i] === "\\" && i + 1 < s.length && isEscapable(s[i + 1]!)) {
      i += 1; // loop +1 skips the escaped char
      continue;
    }
    if (s[i] !== "*") continue;
    // Measure full run of stars starting here
    let end = i;
    while (end < s.length && s[end] === "*") end++;
    const fullRun = end - i;
    if (fullRun < runLen) {
      i = end - 1;
      continue;
    }
    // Candidate close uses the first `runLen` stars of this run; flanking is
    // classified on that sub-run so *** can close *** without the extra *.
    const fl = classifyFlanking(s, i, i + runLen);
    if (canCloseStar(fl)) {
      return i;
    }
    i = end - 1;
  }
  return -1;
}

/** Next single unescaped `*` that is right-flanking and not the start of `**`. */
function findSingleStarClose(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && isEscapable(s[i + 1]!)) {
      i += 1;
      continue;
    }
    if (s[i] !== "*") continue;
    // Skip multi-star runs (bold / triple) — single-italic closer is lone `*`
    if (s[i + 1] === "*") {
      let end = i;
      while (end < s.length && s[end] === "*") end++;
      i = end - 1;
      continue;
    }
    const fl = classifyFlanking(s, i, i + 1);
    if (canCloseStar(fl)) return i;
  }
  return -1;
}

/**
 * Underscore closer: the *first* unescaped `_` after the opener must itself be
 * a valid closer. If it is not (intraword / identifier `_`), the open fails —
 * we do not skip past it to a later `_`. That keeps `_snake_case_identifier_`
 * fully literal while `say _italic_ now` still emphasizes.
 */
function findUnderscoreClose(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && isEscapable(s[i + 1]!)) {
      i += 1;
      continue;
    }
    if (s[i] !== "_") continue;
    const fl = classifyFlanking(s, i, i + 1);
    if (canCloseUnderscore(fl)) return i;
    // First `_` is not a valid closer → abort (do not search further).
    return -1;
  }
  return -1;
}

/**
 * Try to parse a numeric citation `[N]` at `start` (must be on '[').
 * Only `[` + one or more ASCII digits + `]`. Not a citation when immediately
 * followed by `(` (markdown link wins). Unterminated `[1` → null (literal).
 * Linear: scans only the digits inside the brackets.
 */
function tryParseCitation(
  s: string,
  start: number,
): { index: number; text: string; end: number } | null {
  if (s[start] !== "[") return null;
  let j = start + 1;
  if (j >= s.length) return null;
  // Require at least one ASCII digit; [a], [], [1a], [ 1 ] are not citations.
  const digit0 = s.charCodeAt(j);
  if (digit0 < 0x30 || digit0 > 0x39) return null;
  j += 1;
  while (j < s.length) {
    const code = s.charCodeAt(j);
    if (code < 0x30 || code > 0x39) break;
    j += 1;
  }
  if (j >= s.length || s[j] !== "]") return null;
  // `[N](` is a markdown link label, not a citation — even if the link is incomplete.
  if (s[j + 1] === "(") return null;
  const numStr = s.slice(start + 1, j);
  // parseInt is safe: we already verified the slice is pure ASCII digits.
  const index = parseInt(numStr, 10);
  return {
    index,
    text: s.slice(start, j + 1),
    end: j + 1,
  };
}

/**
 * Try to parse `[text](url)` or `[text](url "title")` / `[text](url 'title')`
 * at `start` (must be on '[').
 * `nextBracket[i]` is the next `]` at or after i, or -1 (precomputed once).
 * Returns null if the construct is incomplete — caller emits literal '['.
 */
function tryParseLink(
  s: string,
  start: number,
  nextBracket: Int32Array,
): { text: string; href: string; end: number } | null {
  if (s[start] !== "[") return null;

  // O(1) via precomputed table — never re-scan the whole string per `[`.
  const closeBracket = nextBracket[start + 1] ?? -1;
  if (closeBracket === -1) return null;
  if (s[closeBracket + 1] !== "(") return null;

  // Destination: optional <...>, else raw until space / ) / end.
  // We accept: (url) | (url "title") | (url 'title')
  let j = closeBracket + 2;
  // Skip optional whitespace after (
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  if (j >= s.length) return null;

  let hrefEnd: number;
  let hrefStart = j;

  if (s[j] === "<") {
    // Angle-bracket destination: <url>
    const gt = indexOfUnescaped(s, ">", j + 1);
    if (gt === -1) return null;
    hrefStart = j + 1;
    hrefEnd = gt;
    j = gt + 1;
  } else {
    // Raw destination: up to first whitespace or ')' (unescaped)
    hrefEnd = j;
    while (hrefEnd < s.length) {
      const ch = s[hrefEnd]!;
      if (ch === ")") break;
      if (ch === " " || ch === "\t") break;
      if (ch === "\\" && hrefEnd + 1 < s.length) {
        hrefEnd += 2;
        continue;
      }
      hrefEnd++;
    }
    j = hrefEnd;
  }

  // Optional title after whitespace: "..." or '...'
  while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  if (j < s.length && (s[j] === '"' || s[j] === "'")) {
    const quote = s[j]!;
    const titleClose = indexOfUnescaped(s, quote, j + 1);
    if (titleClose === -1) return null;
    j = titleClose + 1;
    while (j < s.length && (s[j] === " " || s[j] === "\t")) j++;
  }

  if (s[j] !== ")") return null;

  // Unescape backslashes inside href for destination chars we understand
  const rawHref = s.slice(hrefStart, hrefEnd);
  const href = unescapeLinkHref(rawHref);

  return {
    text: s.slice(start + 1, closeBracket),
    href,
    end: j + 1,
  };
}

/** Strip one level of backslash before escapable punctuation in a link href. */
function unescapeLinkHref(href: string): string {
  let out = "";
  for (let i = 0; i < href.length; i++) {
    if (href[i] === "\\" && i + 1 < href.length && isEscapable(href[i + 1]!)) {
      out += href[i + 1]!;
      i++;
      continue;
    }
    out += href[i]!;
  }
  return out;
}
