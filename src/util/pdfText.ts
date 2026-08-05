/**
 * Pure pdf.js text-layer reconstruction for the retrieval loop (remote-PDF phase A).
 * Zero imports — turns `page.getTextContent()` items into clean page text and into
 * page-level documents the retrieval loop can index.
 *
 * Paragraph blank lines: NOT emitted. Measured (max-recall audit): pdf.js empty hasEOL
 * markers absorb block-boundary y-jumps (content→empty has the delta; empty→content is
 * yΔ≈0), so geometry-only heuristics either fire only mid-block (heading splits,
 * knife-edge margins) or miss real blocks. The retrieval loop's sentence chunks plus
 * ~600-char paragraph windows already handle a single-paragraph page (measured
 * iso-dense: many sentence chunks, usable coverage). Emitting only single newlines is
 * the honest outcome. Footer/page-number pollution is not filtered (leave for later).
 *
 * Contract with segmentParagraphs: without blank lines a page is one paragraph chunk
 * at that granularity; sentence granularity remains the primary path.
 *
 * Page-level provenance: pdfPagesToRetrievalDocs emits one doc per page with a text
 * layer (`docId = sourceId#pN`). Pages without a text layer are in `skippedPages`.
 *
 * Paint order only: NEVER sort by reading order (y-then-x).
 *
 * Soft hyphens (policy B, geometry-aware on content→content pairs): when the previous
 * content ends with ASCII `-` or U+00AD and the next content is a same-leading line
 * advance (yΔ > 0.5×font and not a block-sized jump), drop the newline; keep ASCII `-`
 * (`com-pile`), drop U+00AD (`compile`). Never joins across block-sized jumps.
 * Measured retrieval-neutral — kept for passage text quality, not retrieval.
 *
 * Gap rule: typically inert on default pdf.js dumps; synthetic fixture exercises it.
 *
 * String building: array + join("") per pass (same pattern as htmlToText). Hermes uses
 * flat strings so per-char `+=` can reallocate; Node V8 ropes make linearity gates green
 * either way — array form is for Hermes semantics the Node gate cannot observe.
 *
 * Defensive: never throws. Control stripping aligned with htmlToText isAllowedCodePoint
 * (C0/C1/DEL/noncharacters/unpaired surrogates) plus bidi overrides; CR → LF.
 */

/** Mirrors the fields of a pdf.js TextItem we rely on. */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  width?: number;
  /** [scaleX, skewY, skewX, scaleY, x, y] */
  transform?: number[];
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
  hasTextLayer: boolean;
}

export interface PdfRetrievalDoc {
  docId: string;
  title?: string;
  text: string;
}

export interface PdfRetrievalDocsResult {
  docs: PdfRetrievalDoc[];
  skippedPages: number[];
}

export interface ReconstructStats {
  gapSpaces: number;
  cjkDrops: number;
  softHyphenNewlinesDropped: number;
  /**
   * Median of content→content (lineAdvance / fontSize) ratios used to cap soft-hyphen
   * joins (block jumps sit well above this). Null when too few samples.
   */
  medianLineAdvanceRatio: number | null;
}

export function createReconstructStats(): ReconstructStats {
  return {
    gapSpaces: 0,
    cjkDrops: 0,
    softHyphenNewlinesDropped: 0,
    medianLineAdvanceRatio: null,
  };
}

export const TEXT_LAYER_MIN_CHARS = 16;
export const TEXT_LAYER_MAX_FFFD_RATIO = 0.3;
export const MAX_PDF_TITLE_CHARS = 200;

const DEFAULT_FONT_SIZE = 12;
export const Y_NEWLINE_FACTOR = 0.5;
/**
 * Soft-hyphen join only when yΔ/font ≤ this × median line-advance ratio (or
 * SOFT_HYPHEN_FALLBACK_MAX_FONT when no median). Blocks large jumps without
 * emitting paragraph blank lines.
 */
export const SOFT_HYPHEN_MAX_RATIO_FACTOR = 1.35;
/** Max yΔ/font for soft-hyphen when median is unavailable (allows ~double-space). */
export const SOFT_HYPHEN_FALLBACK_MAX_FONT = 2.2;
export const MIN_LINE_ADVANCES_FOR_MEDIAN = 4;
const X_SPACE_FACTOR = 0.25;
const CJK_SPACE_LOOKAHEAD_BUDGET = 64;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function itemFontSize(item: PdfTextItem | null | undefined): number {
  if (!item) return 0;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 4) return 0;
  const h01 = Math.hypot(finiteOr(t[0], 0), finiteOr(t[1], 0));
  if (h01 > 0 && Number.isFinite(h01)) return h01;
  const h23 = Math.hypot(finiteOr(t[2], 0), finiteOr(t[3], 0));
  if (h23 > 0 && Number.isFinite(h23)) return h23;
  return 0;
}

function resolveFontSize(
  prev: PdfTextItem | null | undefined,
  cur: PdfTextItem | null | undefined,
): number {
  return itemFontSize(prev) || itemFontSize(cur) || DEFAULT_FONT_SIZE;
}

function hasUsableGeometry(item: PdfTextItem | null | undefined): boolean {
  if (!item) return false;
  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return false;
  return Number.isFinite(t[4]) && Number.isFinite(t[5]);
}

function xOf(item: PdfTextItem): number {
  return finiteOr(item.transform![4], 0);
}

function yOf(item: PdfTextItem): number {
  return finiteOr(item.transform![5], 0);
}

function widthOf(item: PdfTextItem | null | undefined): number {
  if (!item) return 0;
  return typeof item.width === "number" && Number.isFinite(item.width)
    ? item.width
    : 0;
}

function itemStr(item: PdfTextItem | null | undefined): string {
  if (!item || typeof item.str !== "string") return "";
  return item.str;
}

/** Aligned with htmlToText isAllowedCodePoint + bidi overrides. */
function isAllowedCodePoint(cp: number): boolean {
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp === 0) return false;
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) return false;
  if (cp >= 0x7f && cp <= 0x9f) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  if ((cp & 0xffff) >= 0xfffe) return false;
  if (cp >= 0x202a && cp <= 0x202e) return false;
  if (cp >= 0x2066 && cp <= 0x2069) return false;
  if (cp === 0xfeff) return false;
  return true;
}

function sanitizeText(s: string): string {
  let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts: string[] = [];
  for (let i = 0; i < t.length; ) {
    const cp = t.codePointAt(i)!;
    const w = cp > 0xffff ? 2 : 1;
    i += w;
    if (!isAllowedCodePoint(cp)) continue;
    parts.push(String.fromCodePoint(cp));
  }
  return parts.join("");
}

function isSpaceOnly(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== " " && s[i] !== "\t") return false;
  }
  return true;
}

export function isCjkCodePoint(cp: number): boolean {
  return (
    (cp >= 0x2e80 && cp <= 0x2eff) ||
    (cp >= 0x2f00 && cp <= 0x2fdf) ||
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xffef) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0x2ceb0 && cp <= 0x2ebef)
  );
}

function isCombiningMark(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  );
}

function lastBaseCodePoint(s: string): number | null {
  if (!s) return null;
  let i = s.length;
  while (i > 0) {
    i--;
    if (i > 0) {
      const hi = s.charCodeAt(i - 1);
      const lo = s.charCodeAt(i);
      if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) {
        i--;
        const cp = s.codePointAt(i)!;
        if (isCombiningMark(cp)) continue;
        return cp;
      }
    }
    const cp = s.codePointAt(i)!;
    if (isCombiningMark(cp)) continue;
    return cp;
  }
  return null;
}

function firstCodePoint(s: string): number | null {
  if (!s) return null;
  const cp = s.codePointAt(0);
  return cp === undefined ? null : cp;
}

function peekNextContentFirstCp(
  items: PdfTextItem[],
  from: number,
): number | null {
  let spaceBudget = CJK_SPACE_LOOKAHEAD_BUDGET;
  for (let j = from; j < items.length; j++) {
    const it = items[j];
    if (!it || typeof it !== "object") continue;
    const s = sanitizeText(itemStr(it));
    if (!s) continue;
    if (isSpaceOnly(s)) {
      spaceBudget--;
      if (spaceBudget < 0) return null;
      continue;
    }
    return firstCodePoint(s);
  }
  return null;
}

function medianOf(values: number[]): number {
  const a = values.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  if (a.length % 2 === 1) return a[mid]!;
  return (a[mid - 1]! + a[mid]!) / 2;
}

interface ContentRef {
  item: PdfTextItem;
  y: number;
  x: number;
  width: number;
  text: string;
}

function listNonEmptyContent(
  items: PdfTextItem[],
): { item: PdfTextItem; str: string }[] {
  const out: { item: PdfTextItem; str: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== "object") continue;
    const str = sanitizeText(itemStr(it));
    if (!str || isSpaceOnly(str)) continue;
    out.push({ item: it, str });
  }
  return out;
}

function collectLineAdvanceRatios(
  content: { item: PdfTextItem; str: string }[],
): number[] {
  const ratios: number[] = [];
  for (let i = 1; i < content.length; i++) {
    const prev = content[i - 1]!.item;
    const cur = content[i]!.item;
    if (!hasUsableGeometry(prev) || !hasUsableGeometry(cur)) continue;
    const fontSize = resolveFontSize(prev, cur);
    const yDelta = Math.abs(yOf(cur) - yOf(prev));
    if (!Number.isFinite(yDelta)) continue;
    if (yDelta > fontSize * Y_NEWLINE_FACTOR) {
      ratios.push(yDelta / fontSize);
    }
  }
  return ratios;
}

/** True if yDelta is a line advance but not a block-sized jump (for soft-hyphen). */
function isSoftHyphenLineAdvance(
  yDelta: number,
  fontSize: number,
  medianRatio: number | null,
): boolean {
  if (!Number.isFinite(yDelta) || yDelta <= fontSize * Y_NEWLINE_FACTOR) {
    return false;
  }
  const maxY =
    medianRatio !== null
      ? SOFT_HYPHEN_MAX_RATIO_FACTOR * medianRatio * fontSize
      : SOFT_HYPHEN_FALLBACK_MAX_FONT * fontSize;
  return yDelta <= maxY;
}

function endsWithAsciiHyphen(s: string): boolean {
  let i = s.length - 1;
  while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
  return i >= 0 && s[i] === "-";
}

function endsWithSoftHyphen(s: string): boolean {
  let i = s.length - 1;
  while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
  return i >= 0 && s[i] === "\u00AD";
}

function stripTrailingSoftHyphen(s: string): string {
  let i = s.length - 1;
  while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
  if (i >= 0 && s[i] === "\u00AD") {
    i--;
    while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
    return s.slice(0, i + 1);
  }
  return s;
}

function stripTrailingSoftHyphenFromParts(parts: string[]): void {
  for (let p = parts.length - 1; p >= 0; p--) {
    const s = parts[p]!;
    if (!s) continue;
    const next = stripTrailingSoftHyphen(s);
    if (next !== s) {
      parts[p] = next;
      return;
    }
    if (s.trim().length > 0) return;
  }
}

/** Keep trailing ASCII `-`, drop spaces/tabs after it (seam shapes from pdf.js). */
function trimTrailingWsAfterAsciiHyphenInParts(parts: string[]): void {
  for (let p = parts.length - 1; p >= 0; p--) {
    const s = parts[p]!;
    if (!s) continue;
    let i = s.length - 1;
    while (i >= 0 && (s[i] === " " || s[i] === "\t")) i--;
    if (i >= 0 && s[i] === "-") {
      parts[p] = s.slice(0, i + 1);
      return;
    }
    if (s.trim().length > 0) return;
  }
}

function tidyWhitespace(text: string): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
      if (j < text.length && text[j] === "\n") {
        parts.push("\n");
        i = j;
        continue;
      }
      while (i < j) {
        parts.push(text[i]!);
        i++;
      }
      i--;
      continue;
    }
    parts.push(ch);
  }
  let s = parts.join("");
  const out: string[] = [];
  let nlRun = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      nlRun++;
      if (nlRun <= 2) out.push("\n");
    } else {
      nlRun = 0;
      out.push(s[i]!);
    }
  }
  s = out.join("");
  let start = 0;
  while (
    start < s.length &&
    (s[start] === " " || s[start] === "\t" || s[start] === "\n")
  ) {
    start++;
  }
  let end = s.length;
  while (
    end > start &&
    (s[end - 1] === " " || s[end - 1] === "\t" || s[end - 1] === "\n")
  ) {
    end--;
  }
  return s.slice(start, end);
}

/**
 * Reconstruct plain text from pdf.js text items in **paint order**.
 * Never sorts. Never throws. Empty/null/undefined → "".
 * Single newlines only (no paragraph blank lines — see header).
 */
export function reconstructPageText(
  items: PdfTextItem[] | null | undefined,
  stats?: ReconstructStats,
): string {
  if (!Array.isArray(items) || items.length === 0) return "";

  const contentList = listNonEmptyContent(items);
  const ratios = collectLineAdvanceRatios(contentList);
  let medianRatio: number | null = null;
  if (ratios.length >= MIN_LINE_ADVANCES_FOR_MEDIAN) {
    medianRatio = medianOf(ratios);
  }
  if (stats) stats.medianLineAdvanceRatio = medianRatio;

  const parts: string[] = [];
  let lastChar = "";
  let lastContent: ContentRef | null = null;
  let pendingHyphenEol = false;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== "object") continue;

    let str = sanitizeText(itemStr(it));

    if (str.length > 0 && isSpaceOnly(str) && !it.hasEOL) {
      const before = lastBaseCodePoint(lastChar);
      const after = peekNextContentFirstCp(items, i + 1);
      if (
        before !== null &&
        after !== null &&
        isCjkCodePoint(before) &&
        isCjkCodePoint(after)
      ) {
        if (stats) stats.cjkDrops++;
        continue;
      }
    }

    if (!str) {
      if (it.hasEOL && lastChar !== "\n" && !pendingHyphenEol) {
        parts.push("\n");
        lastChar = "\n";
      }
      continue;
    }

    if (lastContent && hasUsableGeometry(it) && hasUsableGeometry(lastContent.item)) {
      const fontSize = resolveFontSize(lastContent.item, it);
      const yDelta = Math.abs(yOf(it) - lastContent.y);
      const prevEnd = lastContent.x + lastContent.width;
      const gap = xOf(it) - prevEnd;
      const gapOk = Number.isFinite(gap);
      const yOk = Number.isFinite(yDelta);
      const lineAdv =
        yOk && yDelta > fontSize * Y_NEWLINE_FACTOR;
      const softJoin =
        lineAdv &&
        isSoftHyphenLineAdvance(yDelta, fontSize, medianRatio);

      if (lineAdv || pendingHyphenEol) {
        if (
          softJoin &&
          (endsWithSoftHyphen(lastContent.text) ||
            endsWithAsciiHyphen(lastContent.text))
        ) {
          if (endsWithSoftHyphen(lastContent.text)) {
            stripTrailingSoftHyphenFromParts(parts);
          } else {
            // ASCII `-` + optional trailing space/tab before EOL: keep hyphen only
            trimTrailingWsAfterAsciiHyphenInParts(parts);
          }
          lastChar = parts.length ? parts[parts.length - 1]!.slice(-1) : "";
          // Drop leading whitespace on the continued fragment
          str = str.replace(/^[ \t]+/, "");
          if (stats) stats.softHyphenNewlinesDropped++;
          pendingHyphenEol = false;
          // no newline — soft join
        } else {
          if (lastChar !== "\n") {
            parts.push("\n");
            lastChar = "\n";
          }
          pendingHyphenEol = false;
        }
      } else if (
        gapOk &&
        gap > fontSize * X_SPACE_FACTOR &&
        lastChar !== " " &&
        lastChar !== "\t" &&
        lastChar !== "\n" &&
        str[0] !== " " &&
        str[0] !== "\t"
      ) {
        const leftCp = lastBaseCodePoint(lastChar);
        const rightCp = firstCodePoint(str);
        if (
          leftCp === null ||
          rightCp === null ||
          !isCjkCodePoint(leftCp) ||
          !isCjkCodePoint(rightCp)
        ) {
          parts.push(" ");
          lastChar = " ";
          if (stats) stats.gapSpaces++;
        }
        if (pendingHyphenEol && lastChar !== "\n") {
          parts.push("\n");
          lastChar = "\n";
          pendingHyphenEol = false;
        }
      } else if (pendingHyphenEol) {
        if (lastChar !== "\n") {
          parts.push("\n");
          lastChar = "\n";
        }
        pendingHyphenEol = false;
      }
    } else if (pendingHyphenEol) {
      if (lastChar !== "\n") {
        parts.push("\n");
        lastChar = "\n";
      }
      pendingHyphenEol = false;
    }

    parts.push(str);
    lastChar = str.charAt(str.length - 1) || lastChar;
    if (str.length >= 2) {
      const cp = str.codePointAt(str.length - 2);
      if (cp !== undefined && cp > 0xffff) {
        lastChar = String.fromCodePoint(cp);
      }
    }

    if (it.hasEOL && lastChar !== "\n" && !str.endsWith("\n")) {
      if (endsWithAsciiHyphen(str) || endsWithSoftHyphen(str)) {
        pendingHyphenEol = true;
      } else {
        parts.push("\n");
        lastChar = "\n";
      }
    }

    lastContent = {
      item: it,
      y: hasUsableGeometry(it) ? yOf(it) : lastContent ? lastContent.y : 0,
      x: hasUsableGeometry(it) ? xOf(it) : 0,
      width: widthOf(it),
      text: str,
    };
  }

  if (pendingHyphenEol && lastChar !== "\n") {
    parts.push("\n");
  }

  let joined = parts.join("");
  // Drop any remaining U+00AD (discretionary; never meant to be visible)
  {
    const cleaned: string[] = [];
    for (let i = 0; i < joined.length; ) {
      const cp = joined.codePointAt(i)!;
      const w = cp > 0xffff ? 2 : 1;
      i += w;
      if (cp === 0x00ad) continue;
      cleaned.push(String.fromCodePoint(cp));
    }
    joined = cleaned.join("");
  }

  return tidyWhitespace(joined);
}

function isWhitespaceOrFormatCodePoint(cp: number): boolean {
  return (
    cp === 0x20 ||
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000 ||
    cp === 0xfeff
  );
}

function isGarbageCodePoint(cp: number): boolean {
  if (cp === 0xfffd) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true;
  if ((cp & 0xffff) >= 0xfffe) return true;
  return false;
}

export function pageHasTextLayer(text: string | null | undefined): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  let nonWs = 0;
  let garbage = 0;
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const lo = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (lo < 0xdc00 || lo > 0xdfff) {
        nonWs++;
        garbage++;
        i++;
        continue;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      nonWs++;
      garbage++;
      i++;
      continue;
    }
    const cp = text.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (isWhitespaceOrFormatCodePoint(cp)) continue;
    nonWs++;
    if (isGarbageCodePoint(cp)) garbage++;
  }
  if (nonWs < TEXT_LAYER_MIN_CHARS) return false;
  if (garbage / nonWs > TEXT_LAYER_MAX_FFFD_RATIO) return false;
  return true;
}

export function buildPdfPageTexts(
  pages: { pageNumber: number; items: PdfTextItem[] }[] | null | undefined,
): PdfPageText[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];

  const out: PdfPageText[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p || typeof p !== "object") continue;
    const pageNumber = p.pageNumber;
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber)) {
      continue;
    }
    if (pageNumber < 1) continue;

    const items = Array.isArray(p.items) ? p.items : [];
    const text = reconstructPageText(items);
    out.push({
      pageNumber,
      text,
      hasTextLayer: pageHasTextLayer(text),
    });
  }

  out.sort((a, b) => a.pageNumber - b.pageNumber);
  return out;
}

function capTitle(title: string, maxChars: number): string {
  if (title.length <= maxChars) return title;
  let end = maxChars;
  if (end > 0) {
    const c = title.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  }
  if (end > 0) {
    const c = title.charCodeAt(end - 1);
    if (c >= 0xdc00 && c <= 0xdfff) {
      if (
        end < 2 ||
        title.charCodeAt(end - 2) < 0xd800 ||
        title.charCodeAt(end - 2) > 0xdbff
      ) {
        end -= 1;
      }
    }
  }
  if (end <= 0) return "";
  return title.slice(0, end);
}

function sanitizeTitle(title: string): string {
  let t = sanitizeText(title);
  {
    const parts: string[] = [];
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      parts.push(ch === "\n" || ch === "\r" ? " " : ch);
    }
    t = parts.join("");
  }
  {
    const parts: string[] = [];
    let sp = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]!;
      if (ch === " " || ch === "\t") {
        if (!sp) parts.push(" ");
        sp = true;
      } else {
        sp = false;
        parts.push(ch);
      }
    }
    t = parts.join("").trim();
  }
  return capTitle(t, MAX_PDF_TITLE_CHARS);
}

export function pdfPagesToRetrievalDocs(
  sourceId: string,
  title: string | null | undefined,
  pages: PdfPageText[] | null | undefined,
): PdfRetrievalDocsResult {
  if (typeof sourceId !== "string" || sourceId.length === 0) {
    return { docs: [], skippedPages: [] };
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    return { docs: [], skippedPages: [] };
  }

  let baseTitle: string | null = null;
  if (typeof title === "string" && title.length > 0) {
    const cleaned = sanitizeTitle(title);
    baseTitle = cleaned.length > 0 ? cleaned : null;
  }

  const docs: PdfRetrievalDoc[] = [];
  const skippedPages: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (!p || typeof p !== "object") continue;
    if (typeof p.pageNumber !== "number" || !Number.isInteger(p.pageNumber)) {
      continue;
    }

    if (
      !p.hasTextLayer ||
      typeof p.text !== "string" ||
      p.text.length === 0
    ) {
      skippedPages.push(p.pageNumber);
      continue;
    }

    const docId = `${sourceId}#p${p.pageNumber}`;
    const docTitle =
      baseTitle !== null
        ? `${baseTitle} (p. ${p.pageNumber})`
        : `p. ${p.pageNumber}`;
    docs.push({ docId, title: docTitle, text: p.text });
  }

  return { docs, skippedPages };
}
