/**
 * Pure HTML → plain-text extractor for the retrieval loop (web-fetch phase A).
 * No DOM, no imports — single O(n) forward scan with an explicit state machine
 * (React Native safe).
 *
 * Contract with segmentParagraphs (retrievalLoop): block-level structure becomes
 * blank-line-separated paragraphs so BM25+ paragraph chunks stay coherent.
 * Lists become ONE paragraph of `- ` bullet lines (li emits single `\n`, not `\n\n`).
 *
 * Safety: entity decode runs AFTER the scan (decode-last) so encoded markup like
 * `&lt;script&gt;` never becomes a tag during the scan. Deterministic, never throws.
 *
 * Comment ends at FIRST `-->` (browser behavior). Attacker-forged `&#10;` is kept
 * as a real newline (text-only; accepted).
 */

export interface ExtractedPage {
  /** <title> text, entity-decoded, whitespace-collapsed; null if absent/empty. */
  title: string | null;
  /** Paragraph-structured plain text (blank-line separated blocks). */
  text: string;
  /** True if input, output, or title hit a size cap. */
  truncated: boolean;
}

const MAX_INPUT_CHARS = 1_500_000;
const DEFAULT_MAX_CHARS = 120_000;
const MAX_TITLE_CHARS = 512;

/** Block elements that emit a paragraph break at open and/or close (except li). */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
  "hr",
  "form",
  "fieldset",
  "address",
  "details",
  "summary",
  "menu",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "hgroup",
]);

/** HTML void elements: trailing `/` is a real self-close. */
const VOID_ELEMENTS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "area",
  "base",
  "col",
  "embed",
  "source",
  "track",
  "wbr",
]);

/** RAWTEXT_DROP element names. */
const RAWTEXT_DROP = new Set(["script", "style", "noscript", "template"]);

/** RAWTEXT_KEEP element names (content emitted as literal text). */
const RAWTEXT_KEEP = new Set(["textarea", "xmp"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201D",
  ldquo: "\u201C",
  eacute: "\u00E9",
  egrave: "\u00E8",
  agrave: "\u00E0",
  ograve: "\u00F2",
  ugrave: "\u00F9",
  igrave: "\u00EC",
};

const enum ScanState {
  TEXT = 0,
  TAG = 1,
  COMMENT = 2,
  RAWTEXT_DROP = 3,
  RAWTEXT_KEEP = 4,
  TITLE = 5,
}

/**
 * Back off one code unit when a cut would leave a lone high surrogate.
 * Mirrors truncateWithEllipsis in retriever.ts (F9).
 */
function safeCutEnd(s: string, end: number): number {
  if (end <= 0) return 0;
  if (end >= s.length) return s.length;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) return end - 1;
  return end;
}

function collapseWs(s: string): string {
  return s.replace(/[ \t\r\n\f\v]+/g, " ").trim();
}

function isAsciiAlpha(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isAsciiAlnum(c: number): boolean {
  return isAsciiAlpha(c) || (c >= 48 && c <= 57);
}

function ciCharEq(a: number, b: number): boolean {
  const aa = a >= 65 && a <= 90 ? a + 32 : a;
  const bb = b >= 65 && b <= 90 ? b + 32 : b;
  return aa === bb;
}

/** Case-insensitive match of needle at html[at]. */
function ciMatchAt(html: string, at: number, needle: string): boolean {
  if (at + needle.length > html.length) return false;
  for (let k = 0; k < needle.length; k++) {
    if (!ciCharEq(html.charCodeAt(at + k), needle.charCodeAt(k))) return false;
  }
  return true;
}

/**
 * True if position is a tag-name boundary after a matched name
 * (EOF, or not alnum so name cannot continue).
 */
function isNameBoundary(html: string, afterName: number): boolean {
  if (afterName >= html.length) return true;
  return !isAsciiAlnum(html.charCodeAt(afterName));
}

/**
 * Scan from `from` (just past `<` or `</`) reading an ASCII tag name.
 * Returns { name, next } or null if no name.
 */
function readTagName(
  html: string,
  from: number,
): { name: string; next: number } | null {
  let i = from;
  // skip whitespace after </ or <
  while (i < html.length) {
    const c = html.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      i++;
      continue;
    }
    break;
  }
  if (i >= html.length || !isAsciiAlpha(html.charCodeAt(i))) return null;
  const start = i;
  i++;
  while (i < html.length && isAsciiAlnum(html.charCodeAt(i))) i++;
  return { name: html.slice(start, i).toLowerCase(), next: i };
}

/**
 * Scan attributes until unquoted `>`. Quote-aware: `>` and `<` inside
 * single/double quotes do not end the tag / open markup (F16 / F3 attr).
 * Returns index of `>` or -1 if unterminated (EOF).
 * Also reports whether the tag was marked self-closing (`/` before `>`).
 */
function scanToTagEnd(
  html: string,
  from: number,
): { gt: number; selfClosing: boolean } {
  let i = from;
  let quote: number = 0; // 0 none, 34 ", 39 '
  let selfClosing = false;
  while (i < html.length) {
    const c = html.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
      i++;
      continue;
    }
    if (c === 34 || c === 39) {
      quote = c;
      i++;
      continue;
    }
    if (c === 0x3e /* > */) {
      // self-closing if previous non-ws is /
      let j = i - 1;
      while (j >= from) {
        const pc = html.charCodeAt(j);
        if (pc === 0x20 || pc === 0x09 || pc === 0x0a || pc === 0x0d) {
          j--;
          continue;
        }
        selfClosing = pc === 0x2f; // /
        break;
      }
      return { gt: i, selfClosing };
    }
    i++;
  }
  return { gt: -1, selfClosing: false };
}

/**
 * Whether trailing `/` should be treated as a real self-close.
 * Ignored for script/style/noscript/template/textarea/xmp/head (HTML: not void).
 * Honored when svgDepth > 0 (foreign content), for `svg` at depth 0 (foreign
 * self-close so `<svg/>` does not increment depth), or for HTML void elements.
 */
function honorSelfClosing(
  tag: string,
  svgDepth: number,
  marked: boolean,
): boolean {
  if (!marked) return false;
  if (svgDepth > 0) return true;
  // Foreign element: browsers honor self-closing on svg even at depth 0
  if (tag === "svg") return true;
  if (VOID_ELEMENTS.has(tag)) return true;
  return false;
}

/**
 * Remove tag-like spans from RAWTEXT_KEEP content before emission.
 * Drops `<`+letter / `</`+letter through quote-aware `>` (whole span, like main
 * scan). Keeps literal `a < b` (`<` not followed by a letter). Decode-last is
 * unchanged (runs later on the full body).
 */
function stripTagLikeSpans(s: string): string {
  if (!s) return s;
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out.push(s.slice(i));
      break;
    }
    if (lt > i) out.push(s.slice(i, lt));
    const next = lt + 1;
    if (next >= n) {
      out.push("<");
      break;
    }
    const c = s.charCodeAt(next);
    // </name ...>
    if (c === 0x2f /* / */) {
      if (next + 1 < n && isAsciiAlpha(s.charCodeAt(next + 1))) {
        const { gt } = scanToTagEnd(s, next + 1);
        if (gt < 0) break; // unclosed tag-like → drop rest
        i = gt + 1;
        continue;
      }
      out.push("<");
      i = next;
      continue;
    }
    // <name ...>
    if (isAsciiAlpha(c)) {
      const { gt } = scanToTagEnd(s, next);
      if (gt < 0) break;
      i = gt + 1;
      continue;
    }
    // Literal `<` (e.g. a < b)
    out.push("<");
    i = next;
  }
  return out.join("");
}

/**
 * Earliest position ≥ from at which an unclosed title should end:
 * `</head`, `<body`, or opening of any BLOCK_TAGS member (boundary-checked).
 * Returns -1 if none.
 */
function findTitleStructuralBound(html: string, from: number): number {
  let search = from;
  while (search < html.length) {
    const lt = html.indexOf("<", search);
    if (lt < 0) return -1;

    // </head
    if (ciMatchAt(html, lt, "</head") && isNameBoundary(html, lt + 6)) {
      return lt;
    }

    // <body (open only)
    if (ciMatchAt(html, lt, "<body") && isNameBoundary(html, lt + 5)) {
      return lt;
    }

    // Opening BLOCK_TAGS: <name, not </name
    if (lt + 1 < html.length && html.charCodeAt(lt + 1) !== 0x2f /* / */) {
      const parsed = readTagName(html, lt + 1);
      if (parsed && BLOCK_TAGS.has(parsed.name)) {
        return lt;
      }
    }

    search = lt + 1;
  }
  return -1;
}

/**
 * Decode HTML entities AFTER the scan (safety: encoded tags stay as text).
 * Numeric: drop invalid, surrogates, cp===0, C0 (except \n \t), DEL+C1, noncharacters.
 * `&#10;` kept (may forge paragraph breaks — text-only, accepted, F14).
 */
function decodeEntities(s: string): string {
  return s.replace(
    /&(#(?:x[0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]*);/g,
    (full, body: string) => {
      if (body[0] === "#") {
        let cp: number;
        if (body[1] === "x" || body[1] === "X") {
          cp = parseInt(body.slice(2), 16);
        } else {
          cp = parseInt(body.slice(1), 10);
        }
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
        if (!isAllowedCodePoint(cp)) return "";
        try {
          return String.fromCodePoint(cp);
        } catch {
          return "";
        }
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      if (named !== undefined) return named;
      return full;
    },
  );
}

function isAllowedCodePoint(cp: number): boolean {
  // Surrogates
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  // NUL
  if (cp === 0) return false;
  // C0 controls except TAB (9) and LF (10); reject CR (13) and the rest
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) return false;
  // DEL + C1
  if (cp >= 0x7f && cp <= 0x9f) return false;
  // Noncharacters: FDD0–FDEF and any plane's FFFE/FFFF
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  if ((cp & 0xffff) >= 0xfffe) return false;
  return true;
}

/**
 * Per-line trim + collapse spaces/tabs; collapse 3+ newlines to \n\n; final trim.
 */
function normalizeWhitespace(s: string): string {
  const lines = s.split("\n");
  const cleaned = lines.map((line) => line.replace(/[ \t]+/g, " ").trim());
  let joined = cleaned.join("\n");
  joined = joined.replace(/\n{3,}/g, "\n\n");
  return joined.trim();
}

/**
 * Cap output length. Prefer last \n\n in the final 20% of the window; else hard cut.
 * Both cut sites back off one unit if they would split a surrogate pair (F9).
 */
function applyOutputCap(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  let end = safeCutEnd(text, maxChars);
  const window = text.slice(0, end);
  const searchFrom = Math.floor(end * 0.8);
  const region = window.slice(searchFrom);
  const rel = region.lastIndexOf("\n\n");
  if (rel >= 0) {
    const cut = searchFrom + rel;
    return { text: text.slice(0, cut).trimEnd(), truncated: true };
  }
  end = safeCutEnd(text, end);
  return { text: text.slice(0, end).trimEnd(), truncated: true };
}

function resolveMaxChars(maxChars?: number): number {
  if (maxChars === undefined || maxChars === null) return DEFAULT_MAX_CHARS;
  if (typeof maxChars !== "number" || !Number.isFinite(maxChars) || maxChars <= 0) {
    return DEFAULT_MAX_CHARS;
  }
  return maxChars;
}

/**
 * Convert HTML (or HTML fragment) to paragraph-structured plain text.
 * Single-pass state machine. Never throws. Null/empty/non-string → empty result.
 */
export function htmlToText(
  html: string | null | undefined,
  maxChars?: number,
): ExtractedPage {
  if (html == null || typeof html !== "string" || html.length === 0) {
    return { title: null, text: "", truncated: false };
  }

  let truncated = false;
  let input = html;
  if (input.length > MAX_INPUT_CHARS) {
    const cut = safeCutEnd(input, MAX_INPUT_CHARS);
    input = input.slice(0, cut);
    truncated = true;
  }

  // ── single-pass state machine ──────────────────────────────────────────
  const n = input.length;
  let i = 0;
  let state: ScanState = ScanState.TEXT;
  let svgDepth = 0;
  let inHead = false;
  /** Name of the open RAWTEXT element (lowercase), when in RAWTEXT_* . */
  let rawName = "";
  /** Title capture buffer pieces. */
  const titleBuf: string[] = [];
  let titleLen = 0;
  let titleDone = false; // first eligible title fully captured (or capped)
  let titleTruncated = false;
  const body: string[] = [];

  /** Emit structural markers / decoded text that must keep newlines. */
  const emitBodyRaw = (s: string) => {
    if (!s) return;
    if (svgDepth > 0) return;
    if (inHead) return;
    body.push(s);
  };

  /**
   * Emit TEXT-node content. Pure whitespace (HTML indentation between tags)
   * collapses to a single space so it cannot forge paragraph breaks that would
   * split a list into multiple paragraphs (F11).
   */
  const emitBodyText = (s: string) => {
    if (!s) return;
    if (svgDepth > 0) return;
    if (inHead) return;
    if (/^[ \t\r\n\f\v]+$/.test(s)) {
      body.push(" ");
      return;
    }
    body.push(s);
  };

  const emitTitle = (s: string) => {
    if (!s || titleDone) return;
    const room = MAX_TITLE_CHARS - titleLen;
    if (room <= 0) {
      titleTruncated = true;
      titleDone = true;
      return;
    }
    if (s.length <= room) {
      titleBuf.push(s);
      titleLen += s.length;
    } else {
      // Cap mid-string; back off surrogate
      let take = safeCutEnd(s, room);
      if (take <= 0) {
        titleTruncated = true;
        titleDone = true;
        return;
      }
      titleBuf.push(s.slice(0, take));
      titleLen += take;
      titleTruncated = true;
      titleDone = true;
    }
  };

  /**
   * Emit structural markers for a tag open/close when not in svg / (for most) head.
   * Title is handled separately and never emits body text.
   */
  const emitStructural = (tag: string, isClose: boolean) => {
    if (svgDepth > 0) return;
    // While inHead, still allow title handling elsewhere; no body emission
    if (inHead && tag !== "title") return;

    if (tag === "br" && !isClose) {
      emitBodyRaw("\n");
      return;
    }
    if (tag === "li" && !isClose) {
      // Single newline + bullet → list stays one paragraph (F11)
      emitBodyRaw("\n- ");
      return;
    }
    if (tag === "li" && isClose) {
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      emitBodyRaw("\n\n");
      return;
    }
    // Inline / unknown: single space so words don't glue (F7)
    emitBodyRaw(" ");
  };

  while (i < n) {
    if (state === ScanState.TEXT) {
      // Accumulate until next potential markup `<`
      const lt = input.indexOf("<", i);
      if (lt < 0) {
        emitBodyText(input.slice(i));
        break;
      }
      if (lt > i) {
        emitBodyText(input.slice(i, lt));
      }
      // Decide if `<` starts markup
      const next = lt + 1;
      if (next >= n) {
        // lone `<` at EOF → literal
        emitBodyText("<");
        break;
      }
      const nc = input.charCodeAt(next);

      // Comment: <!--
      if (
        nc === 0x21 /* ! */ &&
        next + 2 < n &&
        input.charCodeAt(next + 1) === 0x2d &&
        input.charCodeAt(next + 2) === 0x2d
      ) {
        state = ScanState.COMMENT;
        i = next + 3;
        continue;
      }

      // Doctype / PI: <!... or <?... → consume to next `>`
      if (nc === 0x21 /* ! */ || nc === 0x3f /* ? */) {
        const gt = input.indexOf(">", next);
        i = gt < 0 ? n : gt + 1;
        continue;
      }

      // Close tag: </name
      if (nc === 0x2f /* / */) {
        if (next + 1 < n && isAsciiAlpha(input.charCodeAt(next + 1))) {
          state = ScanState.TAG;
          i = lt; // TAG handler reads from `<`
          continue;
        }
        // `</` not followed by letter → literal
        emitBodyText("<");
        i = next;
        continue;
      }

      // Open tag: <name
      if (isAsciiAlpha(nc)) {
        state = ScanState.TAG;
        i = lt;
        continue;
      }

      // Otherwise `<` is literal text (F8: a < b)
      emitBodyText("<");
      i = next;
      continue;
    }

    if (state === ScanState.COMMENT) {
      // Ends at FIRST `-->` (browser behavior, F19)
      const close = input.indexOf("-->", i);
      if (close < 0) {
        // Unclosed comment → discard to EOF
        break;
      }
      i = close + 3;
      state = ScanState.TEXT;
      continue;
    }

    if (state === ScanState.RAWTEXT_DROP || state === ScanState.RAWTEXT_KEEP) {
      // Scan for case-insensitive </rawName with name boundary; `<!--` has NO meaning
      const closeNeedle = "</" + rawName;
      let found = -1;
      let search = i;
      while (search < n) {
        // Manual scan for `</` then ci name
        const c0 = input.indexOf("</", search);
        if (c0 < 0) break;
        if (ciMatchAt(input, c0 + 2, rawName) && isNameBoundary(input, c0 + 2 + rawName.length)) {
          found = c0;
          break;
        }
        search = c0 + 2;
      }
      if (found < 0) {
        // Unclosed: discard/emit to EOF then stop
        if (state === ScanState.RAWTEXT_KEEP) {
          emitBodyText(stripTagLikeSpans(input.slice(i)));
        }
        // DROP: discard (leak-safe)
        break;
      }
      if (state === ScanState.RAWTEXT_KEEP && found > i) {
        emitBodyText(stripTagLikeSpans(input.slice(i, found)));
      }
      // Skip the closing tag to its `>`
      const afterName = found + 2 + rawName.length;
      const { gt } = scanToTagEnd(input, afterName);
      i = gt < 0 ? n : gt + 1;
      state = ScanState.TEXT;
      rawName = "";
      continue;
    }

    if (state === ScanState.TITLE) {
      // Scan to boundary-checked </title>; content to title only (never body).
      // Unclosed: end at first </head> / <body / BLOCK open (short-title bound),
      // else cap at 512, then RESUME TEXT so following body markup is preserved.
      let found = -1;
      let search = i;
      while (search < n) {
        const c0 = input.indexOf("</", search);
        if (c0 < 0) break;
        if (ciMatchAt(input, c0 + 2, "title") && isNameBoundary(input, c0 + 2 + 5)) {
          found = c0;
          break;
        }
        search = c0 + 2;
      }
      if (found >= 0) {
        if (found > i) emitTitle(input.slice(i, found));
        titleDone = true;
        const afterName = found + 2 + 5;
        const { gt } = scanToTagEnd(input, afterName);
        i = gt < 0 ? n : gt + 1;
        state = ScanState.TEXT;
        continue;
      }

      // No </title>: structural bound (</head, <body, BLOCK open) before 512-cap
      const bound = findTitleStructuralBound(input, i);
      if (bound >= 0) {
        if (bound > i) emitTitle(input.slice(i, bound));
        titleDone = true;
        i = bound; // resume TEXT at the bound tag (e.g. </head> or <p>)
        state = ScanState.TEXT;
        continue;
      }

      // No bound either → 512-char cap then resume TEXT (long unclosed title)
      const room = MAX_TITLE_CHARS - titleLen;
      if (room > 0 && i < n) {
        const absEnd = safeCutEnd(input, Math.min(n, i + room));
        if (absEnd > i) {
          emitTitle(input.slice(i, absEnd));
          i = absEnd;
        }
      }
      titleTruncated = titleTruncated || titleLen >= MAX_TITLE_CHARS || i < n;
      titleDone = true;
      state = ScanState.TEXT;
      if (i >= n) break;
      continue;
    }

    if (state === ScanState.TAG) {
      // i points at `<`
      const isClose = input.charCodeAt(i + 1) === 0x2f;
      const nameFrom = isClose ? i + 2 : i + 1;
      const parsed = readTagName(input, nameFrom);
      if (!parsed) {
        // Malformed — emit literal `<` and resume
        emitBodyText("<");
        i = i + 1;
        state = ScanState.TEXT;
        continue;
      }
      const tag = parsed.name;
      const { gt, selfClosing: markedSC } = scanToTagEnd(input, parsed.next);
      if (gt < 0) {
        // Unterminated tag at EOF → discard fragment (F16-safe: no partial emit)
        break;
      }
      const realSC = honorSelfClosing(tag, svgDepth, markedSC);
      i = gt + 1;
      state = ScanState.TEXT;

      // ── svg depth (always tracked) ──────────────────────────────────
      if (tag === "svg") {
        if (isClose) {
          if (svgDepth > 0) svgDepth--;
          // no body emission inside/through svg close
        } else if (!realSC) {
          // open: increment then content discarded while depth > 0
          // emit nothing; depth applies to following content
          svgDepth++;
        }
        // self-closing svg: do not increment (F4 / rule 7)
        continue;
      }

      // While inside svg: discard all other tags/content handling (depth only)
      if (svgDepth > 0) {
        // Still need rawtext-safe skip for nested foreign? Prefer entering
        // RAWTEXT_DROP so `<` inside script text cannot confuse the scan.
        if (!isClose && !realSC && RAWTEXT_DROP.has(tag)) {
          state = ScanState.RAWTEXT_DROP;
          rawName = tag;
        } else if (!isClose && !realSC && RAWTEXT_KEEP.has(tag)) {
          // keep content is still discarded by emitBody (svgDepth > 0)
          state = ScanState.RAWTEXT_KEEP;
          rawName = tag;
        }
        continue;
      }

      // ── head open/close / auto-close (F2) ───────────────────────────
      if (tag === "head" && !isClose && !realSC) {
        inHead = true;
        continue;
      }
      if (tag === "head" && isClose) {
        inHead = false;
        continue;
      }
      if (tag === "body" && !isClose) {
        inHead = false;
        // body is not in BLOCK_TAGS; treat as block-ish paragraph break
        emitBodyRaw("\n\n");
        continue;
      }
      // Auto-close head on any block-level opening (browsers do this)
      if (inHead && !isClose && BLOCK_TAGS.has(tag)) {
        inHead = false;
      }

      // ── title (F5/F6/F12/F13/F18) ───────────────────────────────────
      if (tag === "title" && !isClose && !realSC) {
        if (!titleDone && titleLen === 0 && !titleBuf.length) {
          // First eligible title — only reachable outside comment/rawtext/svg
          state = ScanState.TITLE;
        } else {
          // Subsequent titles: drop content until </title>
          state = ScanState.RAWTEXT_DROP;
          rawName = "title";
        }
        continue;
      }
      if (tag === "title" && isClose) {
        continue;
      }

      // ── RAWTEXT_DROP (script|style|noscript|template) ───────────────
      if (!isClose && !realSC && RAWTEXT_DROP.has(tag)) {
        // Trailing / ignored for these (F1) — realSC is false → we open
        state = ScanState.RAWTEXT_DROP;
        rawName = tag;
        continue;
      }

      // ── RAWTEXT_KEEP (textarea|xmp) — F15 ───────────────────────────
      if (!isClose && !realSC && RAWTEXT_KEEP.has(tag)) {
        state = ScanState.RAWTEXT_KEEP;
        rawName = tag;
        continue;
      }

      // Void / self-closing structural
      if (tag === "br") {
        emitStructural("br", false);
        continue;
      }
      if (tag === "hr") {
        emitStructural("hr", isClose);
        continue;
      }

      // Normal open/close structural emission
      if (realSC) {
        // Void-like: emit open structural once (e.g. <hr/>)
        emitStructural(tag, false);
        continue;
      }
      emitStructural(tag, isClose);

      // body open already handled; if block opened while inHead, cleared above
      if (!isClose && tag === "body") {
        inHead = false;
      }
      continue;
    }
  }

  // inHead at EOF: fine — head-only text already dropped; scripts dropped by RAWTEXT

  if (titleTruncated) truncated = true;

  // ── post-scan: decode-last → whitespace → output cap ─────────────────
  let title: string | null = null;
  if (titleBuf.length > 0 || titleLen > 0) {
    const rawTitle = titleBuf.join("");
    const decoded = collapseWs(decodeEntities(rawTitle));
    title = decoded.length > 0 ? decoded : null;
  }

  let text = body.join("");
  text = decodeEntities(text);
  text = normalizeWhitespace(text);

  const cap = resolveMaxChars(maxChars);
  const capped = applyOutputCap(text, cap);
  if (capped.truncated) truncated = true;

  return { title, text: capped.text, truncated };
}
