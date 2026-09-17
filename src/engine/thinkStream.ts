/**
 * Pure think-tag stream cleaner + round-end arbitrator.
 *
 * Qwen3.5 may emit a leading <think>...</think> block when reasoning runs.
 * After a tool round it has
 * also been observed to degenerate into a stream of repeated bare <think>
 * tokens with no close — those must not leak into the UI.
 *
 * Split across two phases so stream and final can diverge by design:
 *
 * 1. STREAM (`cleanDelta`) — conservative: after a mid-text `<think>`, hold
 *    content (do not paint the bubble with raw control tokens). Partial tags
 *    split across deltas are carried until resolved. Forced-open rounds
 *    (`templateOpensThink`) start INSIDE the block: nothing paints before the
 *    template's close arrives, so the reasoning never flashes on the bubble.
 *
 * 2. FINAL (`finalize`) — full-round arbitration on the accumulated raw text:
 *    - Forced-open rounds (`templateOpensThink`, prompt-side fact): the chat
 *      template ended its prompt with an opened think block, so the FIRST
 *      `</think>` in the completion is the boundary the template created —
 *      everything before it is reasoning, not answer. This is what llama.cpp
 *      does with `thinking_forced_open`; the flag comes from the rendered
 *      prompt (LlamaService probes getFormattedChat), never from a text guess.
 *    - Closed `<think>…</think>` pairs anywhere → stripped.
 *    - Leading think block (optional leading whitespace + `<think>`) → stripped
 *      whether closed or truncated, including the leading whitespace.
 *    - ≥2 unclosed mid-text opens → degenerate loop → strip from first open to end.
 *    - Exactly ONE unclosed mid-text open:
 *        · nothing but whitespace after the open → strip from open (truncation
 *          cut right after a bare `<think>`, not a literal mention);
 *        · non-whitespace after the open → keep VERBATIM (literal mention /
 *          code sample, e.g. `"Use <think> tags"`). Pop-in at finalize is fine.
 *    - After open/close strip: residual orphan `</think>` and detached partial
 *      close fragments (`</th…`) are swept (finalize only; not stream).
 *    - Pending partial tag carry at round end → trimmed from final (no `<thi`
 *      / `</thi` pop-in).
 *
 * The reasoning that the phases strip is not destroyed: `thinkingText()`
 * returns the first think span of the round so the UI can show it in a
 * collapsed block. Display-only — prompt replay still replays the raw
 * emission (modelEmittedText), never this field.
 *
 * Dependency-free of llama.rn / RN so it can be unit-tested with a plain
 * tsc + node harness (scripts/thinkStripperHarness.mjs).
 */

import { partialTagSuffixLength } from "./toolCallParser";

export const THINK_OPEN = "<think>";
export const THINK_CLOSE = "</think>";

export type ThinkStreamOptions = {
  /**
   * Prompt-side fact: the rendered generation prompt ended with an opened
   * think block (llama.cpp `thinking_forced_open`) — the chat template opened
   * `<think>` itself, so the completion starts INSIDE think and contains only
   * the closing tag. The first `</think>` is then a boundary: everything
   * before it is reasoning, not answer.
   *
   * Trade-off, named: once the flag is true, a literal `</think>` in text
   * before the model's real close is parsed as that boundary (the template
   * contract says the text up to the first close IS inside think) — the same
   * call llama.cpp makes. Without the flag the old conservative rule holds:
   * a lone close costs only the tag itself, never the preceding text.
   */
  templateOpensThink?: boolean;
};

export type ThinkStreamCleaner = {
  /** Stream-phase: conservative strip; holds partial tags / mid-text think tails. */
  cleanDelta(text: string): string;
  /**
   * Round-end arbitration on the full raw completion text. Uses stream state
   * only for the pending-carry partial-tag tail trim (F4).
   */
  finalize(rawFullText: string): string;
  /**
   * Reasoning stripped from the visible text this round (first think span).
   * Authoritative after finalize (which reconciles it against the full-round
   * parse); before finalize it is the stream-phase capture.
   */
  thinkingText(): string;
};

/** Full-round arbitration result: visible text + reasoning span. */
type ThinkArbitration = {
  text: string;
  thinking: string;
  /** Any think markup seen (or forced-open). Gates finalize's buffer reconcile. */
  sawThink: boolean;
};

/**
 * Pure prompt-side decision: did the rendered generation prompt force the
 * think block open? llama.cpp exposes exactly this as `thinking_forced_open`,
 * computed over the generation prompt (start tag present, no end tag after).
 * No text-based guessing: a jinja result without the flag (older native
 * binary) is treated as NOT forced-open — today's conservative behavior.
 */
export function decideTemplateOpensThink(formatted: {
  type: string;
  thinking_forced_open?: boolean;
  prompt?: string;
}): boolean {
  return formatted.type === "jinja" && formatted.thinking_forced_open === true;
}

/**
 * Full-round think-tag arbitration (pure, no stream state).
 * Exported for direct unit tests of the policy without driving cleanDelta;
 * returns the visible text only (the cleaner's finalize consumes the full
 * result internally).
 */
export function arbitrateThinkTags(
  raw: string,
  opts?: ThinkStreamOptions,
): string {
  return arbitrateThink(raw, opts).text;
}

function arbitrateThink(
  raw: string,
  opts?: ThinkStreamOptions,
): ThinkArbitration {
  let text = raw;
  let thinking = "";
  let thinkingTaken = false;
  let sawThink = opts?.templateOpensThink === true;
  // An EMPTY span must not consume the capture slot: `</think><think>real` —
  // the template-opened block being empty must not swallow the model's own
  // reasoning block that follows.
  const takeThinking = (span: string) => {
    if (thinkingTaken || span.length === 0) return;
    thinkingTaken = true;
    thinking = span;
  };

  // Forced-open round: the template ended its prompt with an opened think
  // block. If the model did not echo its own leading <think>, the first
  // close in the completion closes the TEMPLATE's block: everything before
  // it is reasoning.
  if (opts?.templateOpensThink) {
    const modelOwnOpen = text.match(/^[ \t\r\n]*<think>/);
    if (!modelOwnOpen) {
      const closeIdx = text.indexOf(THINK_CLOSE);
      if (closeIdx === -1) {
        // Truncated inside the template-opened block — all reasoning.
        return { text: "", thinking: text, sawThink: true };
      }
      takeThinking(text.slice(0, closeIdx));
      text = text.slice(closeIdx + THINK_CLOSE.length);
    }
  }

  // Leading think block: round starts with optional whitespace then <think>.
  // Strip the block (closed or truncated) INCLUDING the leading whitespace.
  const leadingOpen = text.match(/^[ \t\r\n]*<think>/);
  if (leadingOpen) {
    sawThink = true;
    const afterOpen = text.slice(leadingOpen[0].length);
    const closeIdx = afterOpen.indexOf(THINK_CLOSE);
    if (closeIdx === -1) {
      // Truncated leading think → empty final (not whitespace-only).
      takeThinking(afterOpen);
      return { text: "", thinking, sawThink };
    }
    takeThinking(afterOpen.slice(0, closeIdx));
    text = afterOpen.slice(closeIdx + THINK_CLOSE.length);
  }

  // Closed pairs anywhere; the first pair's inner is the reasoning span when
  // the forced-open / leading branches did not already take one.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, (pair) => {
    sawThink = true;
    takeThinking(pair.slice(THINK_OPEN.length, pair.length - THINK_CLOSE.length));
    return "";
  });

  // Unclosed opens remaining after closed-pair strip.
  const openIndexes: number[] = [];
  let searchFrom = 0;
  for (;;) {
    const idx = text.indexOf(THINK_OPEN, searchFrom);
    if (idx === -1) break;
    openIndexes.push(idx);
    searchFrom = idx + THINK_OPEN.length;
  }

  if (openIndexes.length > 0) sawThink = true;
  if (openIndexes.length >= 2) {
    // Degenerate loop: strip from first unclosed open to end. The tail is
    // junk, not reasoning — never captured.
    text = text.slice(0, openIndexes[0]);
  } else if (openIndexes.length === 1) {
    const openIdx = openIndexes[0];
    const afterOpen = text.slice(openIdx + THINK_OPEN.length);
    if (afterOpen.trim() === "") {
      // Truncation: bare open with only trailing whitespace → strip from open.
      // A literal mention always has non-whitespace after the tag.
      text = text.slice(0, openIdx);
    }
    // else: keep VERBATIM (literal mention / code sample) — content, so the
    // span is NOT captured as thinking.
  }

  // Residual orphan full closes (a lone </think> with no matching open is
  // leftover markup, not content). We deliberately do NOT sweep mid-string
  // partial fragments like "</th": that prefix is shared by real HTML the
  // model may output (</th>, </thead>), and eating it corrupts legitimate
  // content — a worse trade than the rare, transient "</th<think>…" fragment
  // (which only persists on a kill mid-finalize). Full-close removal + the
  // end-of-string partial trim below are the safe subset.
  if (text.includes(THINK_CLOSE)) {
    sawThink = true;
    text = text.replace(/<\/think>/g, "");
  }

  // Trailing partial close at the very end (a completed reply ending in a bare
  // "</th"…"</think" with nothing after is truncated markup). Floor ≥4 so a
  // reply ending in "</" or "</t" — plausible real text — is never touched;
  // "</th>" etc. end with ">", so a bare prefix at end cannot be valid HTML.
  const tail = partialTagSuffixLength(text, THINK_CLOSE);
  if (tail >= 4) text = text.slice(0, text.length - tail);

  return { text, thinking, sawThink };
}

/**
 * Factory: one cleaner instance per completion round (reset by creating fresh).
 */
export function createThinkStreamCleaner(
  opts?: ThinkStreamOptions,
): ThinkStreamCleaner {
  // Forced-open round: the template already opened the block in the prompt,
  // so the stream starts INSIDE think — the leading-decision below is skipped
  // and nothing paints until the template's close arrives.
  let insideThink = opts?.templateOpensThink === true;
  let thinkCarry = "";
  let thinkDecided = false;
  // Stream-phase capture of the first think span (display-only).
  let thinkBuffer = "";
  let thinkSpanTaken = false;

  const cleanDelta = (raw: string): string => {
    let text = thinkCarry + raw;
    thinkCarry = "";
    let out = "";

    // Leading decision: still possible the round opens with a real <think>
    // (only whitespace seen so far).
    if (!insideThink && !thinkDecided) {
      const trimmed = text.replace(/^[ \t\r\n]+/, "");
      if (trimmed.startsWith(THINK_OPEN)) {
        // Real leading block: drop leading whitespace + open tag, enter strip.
        insideThink = true;
        thinkDecided = true;
        text = trimmed.slice(THINK_OPEN.length);
      } else if (trimmed.length === 0 || THINK_OPEN.startsWith(trimmed)) {
        // Still undecided: whitespace only, or a partial "<think>" prefix —
        // hold and wait for more tokens.
        thinkCarry = text;
        return "";
      } else {
        // Diverges from "<think>": no leading think block; text is content.
        thinkDecided = true;
      }
    }

    let i = 0;
    while (i < text.length) {
      if (insideThink) {
        // Forced-open rounds: a model-echoed leading <think> (possible when
        // the template already opened the block) is markup, not reasoning —
        // skip it before capture so the buffer never holds raw tag text
        // (pre-finalize readers — abort, round flush — see this buffer).
        // While only whitespace has been captured, a partial echo is held,
        // not captured.
        if (
          opts?.templateOpensThink &&
          !thinkSpanTaken &&
          thinkBuffer.trim() === ""
        ) {
          const rest = text.slice(i);
          const ws = rest.match(/^[ \t\r\n]*/) ?? [""];
          const afterWs = rest.slice(ws[0].length);
          if (afterWs.startsWith(THINK_OPEN)) {
            i += ws[0].length + THINK_OPEN.length;
            continue;
          }
          if (afterWs.length === 0 || THINK_OPEN.startsWith(afterWs)) {
            // Could still complete the echo: hold, decide on the next delta.
            thinkCarry = text.slice(i);
            i = text.length;
            break;
          }
          // Not an echo — fall through to the normal close hunt.
        }
        // Nested/repeated opens inside a think region are already stripped
        // (we only hunt for the next close). Partial close at end → carry.
        const closeIdx = text.indexOf(THINK_CLOSE, i);
        if (closeIdx === -1) {
          // Also hold a partial OPEN suffix so a split "<thi" mid-think does
          // not need special handling (it is invisible while insideThink).
          const tail = Math.max(
            partialTagSuffixLength(text.slice(i), THINK_CLOSE),
            partialTagSuffixLength(text.slice(i), THINK_OPEN),
          );
          if (!thinkSpanTaken && text.length - tail > i) {
            thinkBuffer += text.slice(i, text.length - tail);
          }
          if (tail > 0) thinkCarry = text.slice(text.length - tail);
          i = text.length;
          break;
        }
        if (!thinkSpanTaken && closeIdx > i) {
          thinkBuffer += text.slice(i, closeIdx);
          thinkSpanTaken = true;
        }
        insideThink = false;
        i = closeIdx + THINK_CLOSE.length;
        continue;
      }

      // Outside think: re-enter strip on ANY <think> (stream is conservative —
      // final arbitration decides whether a single unclosed open is kept).
      // Drop orphan </think>, hold partial tags of either kind.
      const openIdx = text.indexOf(THINK_OPEN, i);
      const closeIdx = text.indexOf(THINK_CLOSE, i);
      const nextOpen = openIdx === -1 ? Infinity : openIdx;
      const nextClose = closeIdx === -1 ? Infinity : closeIdx;

      if (nextOpen === Infinity && nextClose === Infinity) {
        const tail = Math.max(
          partialTagSuffixLength(text.slice(i), THINK_OPEN),
          partialTagSuffixLength(text.slice(i), THINK_CLOSE),
        );
        out += text.slice(i, text.length - tail);
        if (tail > 0) thinkCarry = text.slice(text.length - tail);
        i = text.length;
        break;
      }

      if (nextOpen <= nextClose) {
        // Emit prefix before the open. F6: if a pending partial close sits
        // immediately before the open (e.g. "</th" + "<think>"), discard it
        // instead of leaking "</th" into the stream.
        let prefix = text.slice(i, openIdx);
        const partialClose = partialTagSuffixLength(prefix, THINK_CLOSE);
        if (partialClose > 0) {
          prefix = prefix.slice(0, prefix.length - partialClose);
        }
        out += prefix;
        insideThink = true;
        i = openIdx + THINK_OPEN.length;
        continue;
      }

      // Orphan close before any open.
      out += text.slice(i, closeIdx);
      i = closeIdx + THINK_CLOSE.length;
    }
    return out;
  };

  const finalize = (rawFullText: string): string => {
    const arbitrated = arbitrateThink(rawFullText, opts);
    let text = arbitrated.text;
    // Reconcile the display buffer with the authoritative round-end parse:
    // when the raw carried think markup (or the template opened the block),
    // the full-round parse is what the visible text actually lost — e.g. a
    // single unclosed mid-text open is a literal mention kept VERBATIM in
    // the text, so its span must come back OUT of the thinking buffer. When
    // the binding already parsed think out of `content` (no markers at all),
    // the stream-phase capture stands.
    if (arbitrated.sawThink) {
      thinkBuffer = arbitrated.thinking;
    }
    // F4: any pending thinkCarry at round end → trim partial open/close
    // fragments so they never pop into persisted text.
    if (thinkCarry.length > 0) {
      const tail = Math.max(
        partialTagSuffixLength(text, THINK_OPEN),
        partialTagSuffixLength(text, THINK_CLOSE),
      );
      if (tail > 0) text = text.slice(0, text.length - tail);
    }
    return text;
  };

  const thinkingText = (): string => thinkBuffer;

  return { cleanDelta, finalize, thinkingText };
}
