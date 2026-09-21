/**
 * The document level of an answer's markdown: GFM pipe tables and fenced code,
 * on top of the block and inline parsers in `./markdown.ts`.
 *
 * Pure, dependency-free and free of React, because STREAMING is what shapes
 * every rule here. While an answer arrives, a fence has no closing marker yet and
 * a table has no separator row yet, so a partial document must render as
 * something honest at every boundary: an unterminated fence grows to the end of
 * the text, a table whose separator row is missing — or still half-arrived, or
 * short of the header's column count — falls back to a paragraph, and no line is
 * ever swallowed, reordered or duplicated. `markdownDocument.test.ts` walks every
 * prefix of a sample document to prove that last part rather than asserting it.
 *
 * Why a separate module instead of new members on `MdBlock`: the old parser is
 * consumed by `src/chat/MarkdownText.tsx`, the interface being replaced, and its
 * `BlockView` ends in a fall-through paragraph branch. Widening the union would
 * break that file's narrowing and force a change to a renderer this step does not
 * own. So the old parser is reused unchanged for everything it already
 * understands — paragraphs, headings, lists, quotes, rules and the whole inline
 * set — and this module adds only the two block kinds it does not have.
 */
import {
  parseInline,
  parseMarkdownBlocks,
  type InlineNode,
  type MdBlock,
} from "./markdown";

/** A column's alignment, from the separator row's colons. `null` is GFM's
 *  default, which is left in a left-to-right paragraph direction. */
export type TableAlign = "left" | "center" | "right";

export type TableCell = InlineNode[];
export type TableRow = TableCell[];

export type DocBlock =
  /** A run of consecutive lines with no blank line between them, handed whole to
   *  the old parser: it already turns them into paragraphs, headings, list
   *  items, quotes and rules. Two runs are two paragraphs, which is exactly the
   *  14 dp rhythm DESIGN.md §2.2 asks for; a single newline inside one run stays
   *  a soft line break, as it does today. */
  | { type: "prose"; blocks: MdBlock[] }
  | {
      type: "table";
      align: readonly (TableAlign | null)[];
      header: TableRow;
      /** Every row normalised to the header's column count (GFM pads short rows
       *  and drops the cells past the last column), so no row can be misread as
       *  a different table's. */
      rows: readonly TableRow[];
    }
  | { type: "code"; lang: string | null; code: string };

/** ```` ``` ```` or `~~~`, up to three spaces of indent, then the info string. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** A closing fence: the same character, at least as long, nothing after it. */
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;
/** One separator-row cell: at least one dash, optionally fenced by colons. */
const DELIMITER_CELL = /^:?-+:?$/;
/** A line that carries no content, so it ends the paragraph it is in. */
const BLANK_LINE = /^[ \t]*$/;

type FenceInfo = { char: string; length: number; indent: number; lang: string | null };

/**
 * Parse a whole answer into document blocks. One left-to-right pass over the
 * lines; a fence or a table consumes the lines it owns and the rest accumulate
 * into prose runs.
 */
export function parseMarkdownDocument(src: string): DocBlock[] {
  if (!src) return [];

  const lines = src.split("\n").map(stripCarriageReturn);
  const blocks: DocBlock[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    if (prose.length === 0) return;
    const parsed = parseMarkdownBlocks(prose.join("\n"));
    prose = [];
    if (parsed.length > 0) blocks.push({ type: "prose", blocks: parsed });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    const fence = matchFenceOpen(line);
    if (fence) {
      flushProse();
      const body: string[] = [];
      let close = i + 1;
      for (; close < lines.length; close += 1) {
        if (isFenceClose(lines[close]!, fence)) break;
        body.push(outdent(lines[close]!, fence.indent));
      }
      // No closing marker — the streaming case. The block runs to the end of the
      // text and grows as the answer does; `close` is then `lines.length`.
      blocks.push({ type: "code", lang: fence.lang, code: body.join("\n") });
      i = close;
      continue;
    }

    if (BLANK_LINE.test(line)) {
      flushProse();
      continue;
    }

    const table = matchTable(lines, i);
    if (table) {
      flushProse();
      blocks.push(table.block);
      i = table.lastLine;
      continue;
    }

    prose.push(line);
  }

  flushProse();
  return blocks;
}

// ── Fences ──────────────────────────────────────────────────────────────────

function matchFenceOpen(line: string): FenceInfo | null {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  const marker = match[2]!;
  const info = match[3]!;
  // CommonMark: a backtick fence's info string may not contain a backtick, so an
  // inline code span that opens a line is never a fence.
  if (marker[0] === "`" && info.includes("`")) return null;
  const trimmed = info.trim();
  return {
    char: marker[0]!,
    length: marker.length,
    indent: match[1]!.length,
    // The first whitespace-delimited word is the language (the rest of the info
    // string is an attribute list in GFM, and nothing here executes it).
    lang: trimmed === "" ? null : (trimmed.split(/\s+/)[0] ?? null),
  };
}

function isFenceClose(line: string, fence: FenceInfo): boolean {
  const match = FENCE_CLOSE.exec(line);
  if (!match) return false;
  const marker = match[1]!;
  return marker[0] === fence.char && marker.length >= fence.length;
}

/** CommonMark removes up to the opening fence's own indent from each line. */
function outdent(line: string, indent: number): string {
  let i = 0;
  while (i < indent && line[i] === " ") i += 1;
  return line.slice(i);
}

// ── Tables ──────────────────────────────────────────────────────────────────

/**
 * A table at `start` iff the next line is a separator row with exactly the
 * header's column count. Anything else — no separator yet, a half-typed one, a
 * column count that does not match — is not a table, and the caller keeps the
 * line as prose, which is what makes a partial table visible while it streams.
 */
function matchTable(
  lines: readonly string[],
  start: number,
): { block: DocBlock; lastLine: number } | null {
  const header = splitRow(lines[start]!);
  if (header === null || header.length === 0) return null;
  const align = parseDelimiterRow(lines[start + 1]);
  if (align === null || align.length !== header.length) return null;

  const rows: TableRow[] = [];
  let lastLine = start + 1;
  for (let i = start + 2; i < lines.length; i += 1) {
    const cells = splitRow(lines[i]!);
    // GFM breaks the table at the first line that is not a row; that line is
    // re-read as whatever it really is, never eaten by the table.
    if (cells === null) break;
    rows.push(toRow(cells, header.length));
    lastLine = i;
  }

  return {
    block: { type: "table", align, header: header.map(parseCell), rows },
    lastLine,
  };
}

function parseDelimiterRow(line: string | undefined): (TableAlign | null)[] | null {
  if (line === undefined) return null;
  const cells = splitRow(line);
  if (cells === null || cells.length === 0) return null;
  const align: (TableAlign | null)[] = [];
  for (const cell of cells) {
    const token = cell.trim();
    if (!DELIMITER_CELL.test(token)) return null;
    const left = token.startsWith(":");
    const right = token.endsWith(":");
    align.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return align;
}

function toRow(cells: readonly string[], columns: number): TableRow {
  const row: TableRow = [];
  for (let i = 0; i < columns; i += 1) row.push(parseCell(cells[i] ?? ""));
  return row;
}

function parseCell(raw: string): TableCell {
  return parseInline(raw.trim());
}

/**
 * The indexes of the line's cell delimiters, or null when it carries none — a
 * line without an unescaped pipe is not a table row at all.
 *
 * `\|` is GFM's only way to put a pipe inside a cell; a pipe preceded by an even
 * run of backslashes is still a delimiter, because `\\` is an escaped backslash.
 * Code spans do NOT protect a pipe: GFM splits the row before it parses inline
 * content, so `` `a|b` `` is two cells, and this parser keeps that behaviour
 * rather than inventing a friendlier one that GitHub does not share.
 */
function splitRow(line: string): string[] | null {
  const delimiters = delimiterIndexes(line);
  if (delimiters.length === 0) return null;
  const cells: string[] = [];
  let start = 0;
  for (const at of delimiters) {
    cells.push(cellText(line, start, at));
    start = at + 1;
  }
  cells.push(cellText(line, start, line.length));
  // GFM: a leading and a trailing pipe are decoration, not empty cells.
  if (delimiters[0] === 0) cells.shift();
  if (delimiters[delimiters.length - 1] === line.length - 1) cells.pop();
  return cells;
}

function delimiterIndexes(line: string): number[] {
  const found: number[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line[i]!;
    if (char === "\\") {
      let run = 1;
      while (i + run < line.length && line[i + run] === "\\") run += 1;
      if (line[i + run] === "|") {
        if (run % 2 === 0) found.push(i + run);
        i += run + 1;
        continue;
      }
      i += run;
      continue;
    }
    if (char === "|") {
      found.push(i);
      i += 1;
      continue;
    }
    i += 1;
  }
  return found;
}

/**
 * One cell's raw text, with an escaping backslash removed from `\|` so the
 * inline parser never sees it — `|` is not in the shared ESCAPABLE set, and
 * widening that set would change what the interface being replaced renders.
 */
function cellText(line: string, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i += 1) {
    const char = line[i]!;
    if (char === "\\" && i + 1 < end && line[i + 1] === "|") {
      out += "|";
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
