/**
 * Tool-call markup that arrives as answer text, kept out of the answer.
 *
 * A model told `tool_choice: "none"` cannot make a structured call, so some of
 * them write one out anyway — measured live on 2026-09-19, at the round cap,
 * Qwen3.6 answered with:
 *
 *     <tool_call>
 *     <function=web_search>
 *     <parameter=query>
 *     weather in Tokyo today
 *     </parameter>
 *     </function>
 *     </tool_call>
 *
 * and the page printed it to the reader as the assistant's words. The phone
 * strips this while streaming (kalsa `src/engine/toolCallParser.ts:432`,
 * `createToolCallDeltaStripper`); this is the same idea for the one dialect
 * seen here.
 *
 * The tags arrive in pieces, so a piece that might be the start of one is held
 * back until the next piece decides it. Nothing is held for longer than a tag:
 * `flush()` releases whatever is still waiting when the stream ends.
 */

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

export interface ToolMarkupStripper {
  /** Add a delta and take back what is safe to show. */
  push(raw: string): string;
  /** Release anything held back. Call once, when the stream is over. */
  flush(): string;
}

export function createToolMarkupStripper(): ToolMarkupStripper {
  let inside = false;
  let carry = "";

  function take(text: string): string {
    let out = "";
    for (;;) {
      if (!inside) {
        const at = text.indexOf(OPEN);
        if (at >= 0) {
          out += text.slice(0, at);
          text = text.slice(at + OPEN.length);
          inside = true;
          continue;
        }
        // Not inside a call: anything but a possible tag start is the answer.
        // A plain "<" at the end of a delta is held until the next one decides
        // whether it opens a call — nothing else can be done, because the tags
        // arrive in pieces and a reader must never see half of one.
        const held = partialSuffix(text, OPEN);
        out += text.slice(0, text.length - held);
        carry = text.slice(text.length - held);
        return out;
      }
      const at = text.indexOf(CLOSE);
      if (at >= 0) {
        text = text.slice(at + CLOSE.length);
        inside = false;
        continue;
      }
      // Inside a call: the text is markup, but its end may be arriving.
      const held = partialSuffix(text, CLOSE);
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
      const rest = inside ? "" : carry;
      carry = "";
      inside = false;
      return rest;
    },
  };
}

/** How many trailing characters could be the beginning of `tag`. */
function partialSuffix(text: string, tag: string): number {
  const most = Math.min(tag.length - 1, text.length);
  for (let length = most; length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}
