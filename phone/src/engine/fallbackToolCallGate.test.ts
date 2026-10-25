/**
 * The fallback-dialect gate: which rounds may run the calls they found, how many
 * a refused round asked for, and what such a round closes with.
 *
 * The device log that started this — "toolChoice":"none","structuredCalls":0,
 * "fallbackCalls":1,"executed":1 — is the shape every case below pins.
 */
import {
  countSuppressedFallbackCalls,
  shouldParseFallbackCalls,
  shouldRunBlankReplyFallback,
} from "./fallbackToolCallGate";
import { parseFallbackToolCalls } from "./toolCallParser";

/** The real LFM2 dialect as the binding emits it: python-call syntax between
 *  the two markers. */
const LFM_CALL =
  '<|tool_call_start|>[web_fetch(url="https://example.com")]<|tool_call_end|>';
/** The Qwen tag pair, for the other dialect. */
const QWEN_CALL =
  '<tool_call>\n{"name": "web_fetch", "arguments": {"url": "https://example.com"}}\n</tool_call>';

const enabled = {
  toolCallingEnabled: true,
  structuredCount: 0,
  toolChoice: "auto" as const,
  hasExecutor: true,
};

describe("shouldParseFallbackCalls", () => {
  it("parses a round that may call a tool and returned none structured", () => {
    expect(shouldParseFallbackCalls(enabled)).toBe(true);
    expect(
      shouldParseFallbackCalls({ ...enabled, toolChoice: "required" }),
    ).toBe(true);
  });

  it("never parses a round that was told not to call a tool", () => {
    // The bug: a "none" round executed the tool it was forbidden to ask for.
    expect(shouldParseFallbackCalls({ ...enabled, toolChoice: "none" })).toBe(false);
  });

  it("does not parse a round the binding already answered with calls", () => {
    expect(
      shouldParseFallbackCalls({ ...enabled, structuredCount: 1 }),
    ).toBe(false);
  });

  it("does not parse when tool calling is off or nothing can run a call", () => {
    expect(
      shouldParseFallbackCalls({ ...enabled, toolCallingEnabled: false }),
    ).toBe(false);
    expect(shouldParseFallbackCalls({ ...enabled, hasExecutor: false })).toBe(false);
  });
});

describe("countSuppressedFallbackCalls", () => {
  const suppressed = {
    gateAllowedParse: false,
    toolCallingEnabled: true,
    toolChoice: "none" as const,
    rawText: LFM_CALL,
  };

  it("counts what the model asked for on a round that was told not to", () => {
    // The S23 round: one refused call, counted, never executed.
    expect(countSuppressedFallbackCalls(suppressed)).toBe(1);
    expect(parseFallbackToolCalls(LFM_CALL)).toHaveLength(1);
  });

  it("counts nothing on a round the gate let through", () => {
    // That path is counted by the parse itself; double counting would inflate it.
    expect(
      countSuppressedFallbackCalls({ ...suppressed, gateAllowedParse: true }),
    ).toBe(0);
  });

  it("counts nothing when tool calling is off for the turn", () => {
    // The bench "none" arm and a tool-less turn are untouched by the gate.
    expect(
      countSuppressedFallbackCalls({ ...suppressed, toolCallingEnabled: false }),
    ).toBe(0);
    expect(
      countSuppressedFallbackCalls({
        ...suppressed,
        gateAllowedParse: false,
        toolChoice: "auto",
      }),
    ).toBe(0);
  });

  it("counts nothing for a round with no markup in it", () => {
    expect(countSuppressedFallbackCalls({ ...suppressed, rawText: "" })).toBe(0);
    expect(
      countSuppressedFallbackCalls({ ...suppressed, rawText: "Just prose." }),
    ).toBe(0);
  });
});

describe("shouldRunBlankReplyFallback", () => {
  const blank = { suppressedCalls: 1, streamedText: "", rawText: LFM_CALL };

  it("runs the fallback for a 'none' round whose only output was a refused call", () => {
    // The S23 turn: a forced "none" round answered with an LFM web_fetch and
    // nothing else. Returning here is the blank bubble.
    expect(shouldRunBlankReplyFallback(blank)).toBe(true);
  });

  it("runs it when the call arrived wrapped in a reasoning span", () => {
    // Stripping tool tags alone leaves the think text behind and reads this
    // blank round as one that said something — the user would get the
    // "Generation was interrupted." marker instead of an answer.
    expect(
      shouldRunBlankReplyFallback({
        ...blank,
        rawText: `<think>The user wants the weather.</think>${LFM_CALL}`,
      }),
    ).toBe(true);
  });

  it("keeps the early return for a 'none' round that said something", () => {
    expect(
      shouldRunBlankReplyFallback({ ...blank, streamedText: "Here is what I found." }),
    ).toBe(false);
    expect(
      shouldRunBlankReplyFallback({ ...blank, rawText: `<think>ok</think>${LFM_CALL}Here it is.` }),
    ).toBe(false);
    // Prose the backend returned without ever streaming counts as said too.
    expect(
      shouldRunBlankReplyFallback({ ...blank, rawText: `${LFM_CALL}\nHere it is.` }),
    ).toBe(false);
  });

  it("keeps the early return when no call was suppressed", () => {
    expect(shouldRunBlankReplyFallback({ ...blank, suppressedCalls: 0 })).toBe(false);
  });

  it("reads both fallback dialects as markup", () => {
    expect(shouldRunBlankReplyFallback({ ...blank, rawText: QWEN_CALL })).toBe(true);
    expect(shouldRunBlankReplyFallback({ ...blank, rawText: LFM_CALL })).toBe(true);
  });
});

describe("the two decisions together", () => {
  const round = (rawText: string, toolChoice: "none" | "auto" = "none") => {
    const args = {
      toolCallingEnabled: true,
      structuredCount: 0,
      toolChoice,
      hasExecutor: true,
      rawText,
    };
    const gateAllowedParse = shouldParseFallbackCalls(args);
    const suppressedCalls = countSuppressedFallbackCalls({
      gateAllowedParse,
      toolCallingEnabled: args.toolCallingEnabled,
      toolChoice: args.toolChoice,
      rawText: args.rawText,
    });
    return {
      gateAllowedParse,
      suppressedCalls,
      routes: shouldRunBlankReplyFallback({ suppressedCalls, streamedText: "", rawText }),
    };
  };

  it("refuses to run the call, counts it, and routes the blank round", () => {
    // The S23 shape, end to end: one call asked for, none executed, and the
    // turn does not close empty.
    expect(round(LFM_CALL)).toEqual({
      gateAllowedParse: false,
      suppressedCalls: 1,
      routes: true,
    });
  });

  it("leaves a plain blank completion exactly as it was", () => {
    // Whitespace, and reasoning with no answer: no call was suppressed, so the
    // turn keeps its existing early return.
    expect(round("   \n ")).toEqual({
      gateAllowedParse: false,
      suppressedCalls: 0,
      routes: false,
    });
    expect(round("<think>still thinking</think>").routes).toBe(false);
  });

  it("parses and runs the same call on a round that may make one", () => {
    expect(round(LFM_CALL, "auto")).toEqual({
      gateAllowedParse: true,
      suppressedCalls: 0,
      routes: false,
    });
  });
});