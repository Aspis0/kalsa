/**
 * Tool-call markup that arrives as answer text, kept out of the answer.
 *
 * The caller runs this only in the round where `tool_choice` forbade a structured call:
 * that is the round where the markup is written. Every other round is the answer, and a
 * reader asking to be shown the tags gets them.
 *
 * Two spellings are hidden here, and they end differently. A legacy block that never
 * closes is given back whole by `flush()`: markup on screen is a blemish, a blank answer
 * is a broken product. A Gemma block is a call in all of it, so one that never closes is
 * dropped.
 */

interface Dialect {
  open: string;
  close: string;
  givesBack: boolean;
}

const LEGACY: Dialect = { open: "<tool_call>", close: "</tool_call>", givesBack: true };
const GEMMA: Dialect = { open: "<|tool_call>", close: "<tool_call|>", givesBack: false };
const DIALECTS: readonly Dialect[] = [LEGACY, GEMMA];
const OPENS: readonly string[] = DIALECTS.map((one) => one.open);

export interface ToolMarkupStripper {
  /** Add a delta and take back what is safe to show. */
  push(raw: string): string;
  /** Release anything held back. Call once, when the stream is over. */
  flush(): string;
}

export function createToolMarkupStripper(): ToolMarkupStripper {
  let dialect: Dialect | null = null;
  /** A possible tag start, waiting for the next delta to decide it. */
  let carry = "";
  /** Text inside a block that has opened and not closed: dropped if it closes. */
  let block = "";

  function take(text: string): string {
    let out = "";
    for (;;) {
      if (dialect === null) {
        const found = findOpen(text);
        if (found !== null) {
          out += text.slice(0, found.at);
          text = text.slice(found.at + found.dialect.open.length);
          dialect = found.dialect;
          block = found.dialect.open;
          continue;
        }
        // Not inside a call: anything but a possible tag start is the answer.
        // A plain "<" at the end of a delta is held until the next one decides
        // whether it opens a call — nothing else can be done, because the tags
        // arrive in pieces and a reader must never see half of one.
        const held = partialSuffix(text, OPENS);
        out += text.slice(0, text.length - held);
        carry = text.slice(text.length - held);
        return out;
      }
      const at = text.indexOf(dialect.close);
      if (at >= 0) {
        // A complete block is markup: it goes, opening tag included.
        text = text.slice(at + dialect.close.length);
        dialect = null;
        block = "";
        continue;
      }
      // Inside a call that has not closed: keep what has arrived, in case it
      // never does, and hold a suffix that may be the closing tag.
      const held = partialSuffix(text, [dialect.close]);
      block += text.slice(0, text.length - held);
      carry = text.slice(text.length - held);
      return out;
    }
  }

  return {
    push(raw) {
      const text = carry + raw;
      carry = "";
      return take(text);
    },
    flush() {
      // A block that never closed was not a call: the legacy spelling is given back
      // whole, the Gemma one is a call in all of it and goes.
      const rest = dialect === null ? carry : dialect.givesBack ? block + carry : "";
      carry = "";
      block = "";
      dialect = null;
      return rest;
    },
  };
}

function findOpen(text: string): { at: number; dialect: Dialect } | null {
  let found: { at: number; dialect: Dialect } | null = null;
  for (const dialect of DIALECTS) {
    const at = text.indexOf(dialect.open);
    if (at < 0) continue;
    if (found === null || at < found.at) found = { at, dialect };
  }
  return found;
}

/** How many trailing characters could be the beginning of one of `tags`. */
function partialSuffix(text: string, tags: readonly string[]): number {
  let most = 0;
  for (const tag of tags) {
    const length = partialSuffixOf(text, tag);
    if (length > most) most = length;
  }
  return most;
}

function partialSuffixOf(text: string, tag: string): number {
  const most = Math.min(tag.length - 1, text.length);
  for (let length = most; length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}
