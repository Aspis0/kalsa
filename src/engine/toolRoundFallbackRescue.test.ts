/**
 * Regression guard for the fallback that answered "I couldn't complete the
 * search" under a Thinking bubble (device log, iPhone, web question).
 *
 * The normal round closes through visibleTurnText: a round truncated inside a
 * template-opened think block arbitrates to reasoning and zero visible text,
 * and the interrupted marker stands in for the answer. The fallback round did
 * NOT — it computed its text, found it empty, and let the canned
 * toolRoundsExhausted message speak, directly under the reasoning it had just
 * emitted. The model produced text; the bubble said it produced nothing.
 *
 * LlamaService.ts value-imports llama.rn, so no Jest test can import it: the
 * wiring is asserted as source text, and the DECISION is exercised through the
 * real modules the fallback path composes (thinkStream's cleaner +
 * toolCallParser's final strip + visibleTurnText). A markup-only fallback is
 * pinned deliberately, below.
 */

import fs from "fs";
import path from "path";

import { hasToolCallMarkup, stripToolCallTagsFinal } from "./toolCallParser";
import { createThinkStreamCleaner, sawThinkTags } from "./thinkStream";
import { visibleTurnText } from "./truncatedTurnText";

const MARKER = "Generation was interrupted.";

const serviceSource = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

/** The source between two stable anchors, so a moved anchor fails loudly. */
function spanBetween(from: string, to: string): string {
  const start = serviceSource.indexOf(from);
  const end = serviceSource.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`missing span anchors: ${from} … ${to}`);
  return serviceSource.slice(start, end);
}

/**
 * The fallback round's close, exactly as LlamaService composes it: think
 * arbitration, then the tool-markup strip, then the visible-turn rescue.
 * Returns what the turn would show; empty means the canned message is emitted.
 */
function fallbackVisibleText(args: {
  emitted: string;
  templateOpensThink: boolean;
  streamedVisibleLength?: number;
}): string {
  const cleaner = createThinkStreamCleaner({
    templateOpensThink: args.templateOpensThink,
  });
  const finalText = stripToolCallTagsFinal(cleaner.finalize(args.emitted)).trim();
  return visibleTurnText({
    finalText,
    streamedVisibleLength: args.streamedVisibleLength ?? 0,
    thinking: cleaner.thinkingText(),
    interruptedMarker: MARKER,
  });
}

describe("the fallback round closes like the normal round", () => {
  test("reasoning with no closed think tag is not an empty turn", () => {
    // The device's round: the template opened the block, the model reasoned and
    // the round ended there. Arbitration correctly yields no answer text.
    expect(fallbackVisibleText({ emitted: "<think>reasoning", templateOpensThink: true }))
      .toBe(MARKER);
    // Same round without the forced-open flag, via the leading-block branch.
    expect(fallbackVisibleText({ emitted: "<think>reasoning", templateOpensThink: false }))
      .toBe(MARKER);
  });

  test("a real answer is never replaced by the marker", () => {
    expect(
      fallbackVisibleText({ emitted: "<think>t</think>Here is the answer.", templateOpensThink: true }),
    ).toBe("Here is the answer.");
  });

  test("PINNED: the canned message needs a round that said AND thought nothing", () => {
    const emitted = '<|tool_call_start|>[web_search(query="kalsa")]';
    expect(stripToolCallTagsFinal(emitted).trim()).toBe("");
    // No think markup anywhere → no reasoning span → nothing to stand in for
    // the answer, so the round keeps the accurate toolRoundsExhausted message.
    // "Generation was interrupted." here would be a lie (nothing was
    // interrupted) and would bury the one fact the user can act on.
    expect(fallbackVisibleText({ emitted, templateOpensThink: false })).toBe("");
    // Forced-open is different, and deliberately so: thinkStream's forced-open
    // branch (thinkStream.ts:142-152) reads an unclosed round's whole text as
    // the reasoning span, so the truncated markup IS reasoning and the marker
    // fires — exactly what the normal round does with the same text.
    expect(
      fallbackVisibleText({ emitted, templateOpensThink: true }),
         ).toBe(MARKER);
  });

  test("markup plus reasoning is closed with the marker, like any other round", () => {
    const emitted = '<think>I should search.<|tool_call_start|>[web_search(query="kalsa")]';
    expect(fallbackVisibleText({ emitted, templateOpensThink: false })).toBe(MARKER);
  });

  test("text already streamed this turn still wins over the marker", () => {
    // Visible text streamed earlier in the turn is on screen; the marker would
    // repeat the round's own rescue only when nothing was ever shown.
    expect(
      fallbackVisibleText({
        emitted: "<think>late reasoning",
        templateOpensThink: false,
        streamedVisibleLength: 120,
      }),
    ).toBe("");
  });

  test("the telemetry facts distinguish the two empty rounds", () => {
    const reasoningOnly = "<think>reasoning";
    const markupOnly = '<|tool_call_start|>[web_search(query="kalsa")]';
    // rawLen>0 + sawThink + no markup is the round the marker now closes...
    expect(sawThinkTags(reasoningOnly, { templateOpensThink: true })).toBe(true);
    expect(hasToolCallMarkup(reasoningOnly)).toBe(false);
    // ...and no think + markup is the one the canned message describes.
    expect(sawThinkTags(markupOnly, { templateOpensThink: false })).toBe(false);
    expect(hasToolCallMarkup(markupOnly)).toBe(true);
  });
});

describe("the wiring in LlamaService", () => {
  const fallbackSpan = spanBetween(
    "const fallbackEmitted = extractRawResultText(fallbackResult);",
    "if (fallbackText) {",
  );
  // emitFinalText is the normal round's close, quoted here so the two spans
  // must stay the same shape: a future change to one has to be argued for
  // against the other.
  const normalSpan = spanBetween("const emitFinalText =", "if (finalText) callbacks.onDelta(");

  test.each([
    ["the fallback round", fallbackSpan],
    ["the normal round", normalSpan],
  ])("%s routes its close through visibleTurnText", (_name, span) => {
    expect(span).toMatch(/visibleTurnText\(\{/);
    expect(span).toMatch(/streamedVisibleLength: streamedText\.length/);
    expect(span).toMatch(/interruptedMarker: strings\.chat\.interrupted/);
  });

  test("the marker is produced from the fallback's own thinking span", () => {
    // The fallback joins the turn's accumulated reasoning before the rescue,
    // so a reasoning-only round is recognized even when this round's cleaner
    // captured nothing.
    expect(fallbackSpan).toMatch(/const fallbackThinking = joinThinking\(/);
    expect(fallbackSpan).toMatch(/thinking: fallbackThinking,/);
    // Thinking still fires, once, from that same value.
    // The span is the round's authoritative one, so it carries the final mark:
    // the host clears a streamed span the fallback reconciled away.
    expect(fallbackSpan).toMatch(
      /callbacks\.onThinkingText\?\.\(fallbackThinking, \{ final: true \}\);/,
    );
  });

  test("the exhausted telemetry carries why the fallback produced nothing", () => {
    const telSpan = spanBetween(
      "exhaustedTel.rawLen = fallbackEmitted.length;",
      "let fallbackText = stripToolCallTagsFinal(",
    );
    expect(telSpan).toMatch(/sawThinkTags\(fallbackEmitted, \{\s*templateOpensThink: fallbackOpensThink,/);
    expect(telSpan).toMatch(/exhaustedTel\.sawToolMarkup = hasToolCallMarkup\(fallbackEmitted\);/);
  });
});