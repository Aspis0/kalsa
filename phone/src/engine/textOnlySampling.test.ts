/**
 * The two settings that make a text-only round land: end generation at the
 * tool-call token, and stop rolling at 0.7.
 *
 * On LFM2.5 2.6B (iPhone, web question) the final round and the rescue both
 * answered with `<|tool_call_start|>` markup and nothing before it, so the turn
 * closed empty. Both settings are deliberately inert on every other round.
 */

import { LFM_TOOL_CALL_START } from "./toolCallParser";
import {
  MAX_TEXT_ONLY_ATTEMPTS,
  TEXT_ONLY_TEMPERATURE,
  usesLfmToolDialect,
  withToolCallStop,
} from "./textOnlySampling";

const STOP_WORDS = ["", "", "<|end_of_text|>", "<|end|>", "</s>", "<turn|>"];

describe("the tool-call stop word", () => {
  test("adds the token the models actually emit", () => {
    expect(LFM_TOOL_CALL_START).toBe("<|tool_call_start|>");
    expect(withToolCallStop(STOP_WORDS)).toEqual([...STOP_WORDS, "<|tool_call_start|>"]);
  });

  test("the turn's own stop words survive, in order, before it", () => {
    // Stopping early must not cost the round its EOS behaviour: an answer that
    // simply ends still ends the same way it always did.
    const out = withToolCallStop(STOP_WORDS);
    expect(out.slice(0, STOP_WORDS.length)).toEqual(STOP_WORDS);
    expect(out).toHaveLength(STOP_WORDS.length + 1);
  });

  test("never mutates the list it was handed", () => {
    // STOP_WORDS is module state shared by every round in the app; a push here
    // would silently put the tool-call stop on tool rounds that need the call.
    const source = [...STOP_WORDS];
    withToolCallStop(source);
    expect(source).toEqual(STOP_WORDS);
  });
});

describe("the text-only settings", () => {
  test("a focused temperature, not the turn's 0.7", () => {
    expect(TEXT_ONLY_TEMPERATURE).toBe(0.3);
  });

  test("a bound that costs a phone two extra completions at most", () => {
    expect(MAX_TEXT_ONLY_ATTEMPTS).toBe(2);
  });
});

describe("whose turn the temperature change is for", () => {
  test("the LFM model, whose tool calls arrive as this markup", () => {
    expect(usesLfmToolDialect("lfm2.5-2.6b")).toBe(true);
    expect(usesLfmToolDialect("LFM2.5-2.6B")).toBe(true);
  });

  test("every other model keeps its own temperature", () => {
    // The change was made from one model's log. A 0.3 round on a model nobody
    // measured is an unforced regression dressed as a fix.
    expect(usesLfmToolDialect("qwen3.5-4b")).toBe(false);
    expect(usesLfmToolDialect("kalsa-remote-mac")).toBe(false);
    expect(usesLfmToolDialect("")).toBe(false);
    expect(usesLfmToolDialect(null)).toBe(false);
    expect(usesLfmToolDialect(undefined)).toBe(false);
  });

  test("an id nobody owns is not the default model's dialect", () => {
    // getModelById resolves an unknown id to the DEFAULT model, and the default
    // is the LFM one — so a predicate fed the resolved record would hand the
    // remote model and every unknown id LFM's sampling. The raw id never does.
    expect(usesLfmToolDialect("a-model-that-does-not-exist")).toBe(false);
  });
});