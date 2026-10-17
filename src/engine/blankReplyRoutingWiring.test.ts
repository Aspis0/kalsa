/**
 * Source-text guard for the blank-reply routing wiring: a "none" round whose
 * only output was a tool call the gate refused must break to the two-tier
 * fallback, and that break must record the round count and the KV divergence
 * BEFORE it happens. LlamaService.ts value-imports llama.rn, so no Jest test
 * can import it — source text is the only reach available (style:
 * runtimeGovernorFallbackWiring.test.ts, kvShiftRefuse.test.ts).
 *
 * Shape only: pins the presence and the ORDER of the substrings, not
 * execution.
 */
import fs from "fs";
import path from "path";

const source = fs.readFileSync(
  path.resolve(__dirname, "LlamaService.ts"),
  "utf8",
);

describe("blank-reply routing in LlamaService", () => {
  test("the suppressed round defers to the pure decision", () => {
    expect(source).toContain("shouldRunBlankReplyFallback({ suppressedCalls, streamedText, rawText })");
    // Counted, never executed: the gate's answer decides the count, and only an
    // allowed round maps calls onto toolCalls.
    expect(source).toContain("const suppressedCalls = countSuppressedFallbackCalls({");
    expect(source).toContain(": suppressedCalls;");
    expect(source).toContain("if (parseFallbackCalls && fallbacks.length > 0) {");
    expect(source).toContain("fallbackCalls = parseFallbackCalls ? fallbacks.length : suppressedCalls;");
  });

  test("the KV marker and the round count land before the break", () => {
    const route = source.indexOf("shouldRunBlankReplyFallback({");
    const marker = source.indexOf('nextKvReproState(kvReproState, "tool_calls_detected")', route);
    const rounds = source.indexOf("roundsUsed = round + 1;", route);
    const brk = source.indexOf("break;", route);
    expect(route).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(route);
    expect(rounds).toBeGreaterThan(route);
    expect(brk).toBeGreaterThan(marker);
    expect(brk).toBeGreaterThan(rounds);
  });

  test("the fallback consumes the real count, not the cap", () => {
    const fallback = source.indexOf("const toolFallbackNeeded = shouldFireToolRoundFallback(");
    expect(fallback).toBeGreaterThan(-1);
    const tail = source.slice(fallback);
    // roundsUsed only ever holds the cap at its declaration and the real count
    // at the break; nothing downstream may re-read the cap.
    expect((source.match(/roundsUsed = MAX_TOOL_ROUNDS;/g) ?? [])).toHaveLength(1);
    expect(tail).toContain("roundsUsed,");
    expect(tail).toContain("coolingRound(roundsUsed, runFallbackRound)");
    expect(tail).toContain("roundsUsed,\n                callbacks,");
    expect(tail).not.toContain("roundsUsed: MAX_TOOL_ROUNDS,");
  });

  test("the fallback round sends the swapped, tools-off prompt", () => {
    // S23: the fallback re-sent the turn's own prompt, whose system message
    // orders a search on the very question the round is closing from the results
    // already in context; LFM answered with tool markup again and the bubble got
    // the canned error. The swap is built once, from currentMessages, and the
    // completion must read the copy — never the turn's array again.
    expect(source).toContain("import { buildFallbackMessages } from \"./fallbackMessages\";");
    expect(source).toContain("const fallbackMessages = buildFallbackMessages(currentMessages, {");
    expect(source).toContain("buildSystemPrompt(locale, false, options.memoryFacts),");
    expect(source).toContain("resultsNote: strings.toolResultsAnswerNote,");
    const call = source.indexOf("const runFallbackRound = () => {");
    expect(call).toBeGreaterThan(-1);
    const callBody = source.slice(call, call + 4000);
    expect(callBody).toContain("messages: fallbackMessages,");
    // The turn's transcript stays the turn's: nothing else in the loop reads the
    // swapped copy, and currentMessages is still what the rounds append to.
    expect((source.match(/messages: fallbackMessages,/g) ?? [])).toHaveLength(1);
  });

  test("the floor message stops naming the last tool", () => {
    // The UI keeps statusLabel while text streams (sendHost.ts) and clears it
    // only at finalize, so the closing text must flip the label the same way the
    // rescue attempt's own first visible delta does. That closing text is the
    // never-empty floor when the turn gathered sources, and the canned message
    // when it gathered none — one line, same flip.
    const floorText = source.indexOf(
      "floorText = sourcesAnswer || strings.errors.toolRoundsExhausted;",
    );
    expect(floorText).toBeGreaterThan(-1);
    // Absolute indices, not a window: the status flip must land between the two
    // floor statements, whichever order the telemetry block around them takes.
    const flip = source.indexOf("callbacks.onStatus?.({ label: strings.chat.writingStatus });", floorText);
    const emit = source.indexOf("callbacks.onDelta(floorText, streamedText);", floorText);
    expect(flip).toBeGreaterThan(floorText);
    expect(emit).toBeGreaterThan(flip);
  });
});