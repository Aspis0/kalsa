/**
 * Production thinking default + preserve_thinking capability.
 */

import {
  resolveThinkingParams,
  thinkingSpeedOpts,
  userTurnLooksLikeToolRequest,
} from "./thinkingBudgets";

const qwen = { thinking: { short: 256, extended: 512 } };
const lfm = {
  thinking: { short: 512, extended: 1024, nPredict: 2048 },
  preserveThinking: true,
};

describe("resolveThinkingParams production default", () => {
  test("no speed measurement selects the model short budget", () => {
    const { fields, nPredict } = resolveThinkingParams("default", lfm);
    expect(fields.enable_thinking).toBe(true);
    expect(fields.thinking_budget_tokens).toBe(512);
    expect(fields.thinking_budget_tokens).toBeGreaterThan(0);
    expect(nPredict).toBe(2048);
  });

  test.each([
    [3.4, 512],
    [5, 1024],
    [11, 1024],
  ])("speed %s selects the expected default budget", (decodeTokPerSec, budget) => {
    const { fields } = resolveThinkingParams("default", lfm, {
      decodeTokPerSec,
    });
    expect(fields.thinking_budget_tokens).toBe(budget);
  });

  test("forceShort keeps the short budget even when EMA would extend", () => {
    const { fields } = resolveThinkingParams("default", lfm, {
      decodeTokPerSec: 11,
      forceShort: true,
    });
    expect(fields.thinking_budget_tokens).toBe(512);
  });

  test("null model: historical short 256, never budget 0", () => {
    const { fields } = resolveThinkingParams("default", null);
    expect(fields.enable_thinking).toBe(true);
    expect(fields.thinking_budget_tokens).toBe(256);
  });
});

describe("userTurnLooksLikeToolRequest", () => {
  test("detects calc-shaped turns", () => {
    expect(userTurnLooksLikeToolRequest("calcolatrice 18+7")).toBe(true);
    expect(userTurnLooksLikeToolRequest("Quanto fa 2+2?")).toBe(true);
    expect(userTurnLooksLikeToolRequest("calcolare")).toBe(true);
    expect(userTurnLooksLikeToolRequest("somma 3 e 5")).toBe(true);
    expect(userTurnLooksLikeToolRequest("18 più 7")).toBe(true);
    expect(userTurnLooksLikeToolRequest("18 - 7")).toBe(true);
    expect(userTurnLooksLikeToolRequest("18 / 7")).toBe(true);
    expect(userTurnLooksLikeToolRequest("ciao")).toBe(false);
    expect(userTurnLooksLikeToolRequest("")).toBe(false);
  });

  test("does not treat dates, ranges, versions, or bare più as calc", () => {
    expect(userTurnLooksLikeToolRequest("2026-09-11")).toBe(false);
    expect(userTurnLooksLikeToolRequest("10-20 minuti")).toBe(false);
    expect(userTurnLooksLikeToolRequest("12/25/2026")).toBe(false);
    expect(userTurnLooksLikeToolRequest("versione 3x2")).toBe(false);
    expect(userTurnLooksLikeToolRequest("4x4")).toBe(false);
    expect(userTurnLooksLikeToolRequest("un caffè in più")).toBe(false);
  });
});

describe("thinkingSpeedOpts", () => {
  test("sets forceShort from the last user message", () => {
    expect(thinkingSpeedOpts(11, "calcolatrice 18+7")).toEqual({
      decodeTokPerSec: 11,
      forceShort: true,
    });
    expect(thinkingSpeedOpts(11, "ciao")).toEqual({
      decodeTokPerSec: 11,
      forceShort: false,
    });
    expect(thinkingSpeedOpts(null, "18 più 7")).toEqual({
      decodeTokPerSec: null,
      forceShort: true,
    });
  });
});

describe("preserve_thinking", () => {
  test("stripping model emits preserve_thinking: true", () => {
    const { fields } = resolveThinkingParams("default", lfm);
    expect(fields.chat_template_kwargs).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
  });

  test("Qwen default does not emit preserve_thinking", () => {
    const { fields } = resolveThinkingParams("default", qwen);
    expect(fields.chat_template_kwargs).toBeUndefined();
    expect(fields.chat_template_kwargs?.preserve_thinking).toBeUndefined();
  });
});

describe("all accepted thinking modes", () => {
  test("every accepted mode keeps thinking enabled and budget positive", () => {
    for (const mode of ["default", "budget256", "budget512"] as const) {
      const { fields } = resolveThinkingParams(mode, qwen);
      expect(fields.enable_thinking).toBe(true);
      expect(fields.thinking_budget_tokens).toBeGreaterThan(0);
      expect(fields.enable_thinking).not.toBe(false);
      expect(fields.thinking_budget_tokens).not.toBe(0);
    }
  });

  test("bench modes still select short/extended explicitly", () => {
    expect(
      resolveThinkingParams("budget256", lfm, { decodeTokPerSec: 11 }).fields
        .thinking_budget_tokens,
    ).toBe(512);
    expect(
      resolveThinkingParams("budget512", lfm, { decodeTokPerSec: 3.4 }).fields
        .thinking_budget_tokens,
    ).toBe(1024);
  });

  test("preserveThinking keeps the live mode enabled", () => {
    for (const mode of ["default", "budget256", "budget512"] as const) {
      const { fields } = resolveThinkingParams(mode, lfm);
      expect(fields.chat_template_kwargs).toEqual({
        enable_thinking: true,
        preserve_thinking: true,
      });
    }
  });
});
