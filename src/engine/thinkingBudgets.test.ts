/**
 * Production thinking default + preserve_thinking capability.
 */

import { resolveThinkingParams } from "./thinkingBudgets";

const qwen = { thinking: { short: 256, extended: 512 } };
const lfm = { thinking: { short: 256, extended: 512 }, preserveThinking: true };

describe("resolveThinkingParams production default", () => {
  test("model with thinking budgets: enable_thinking on, budget is short (never 0)", () => {
    const { fields, nPredict } = resolveThinkingParams("default", qwen);
    expect(fields.enable_thinking).toBe(true);
    expect(fields.thinking_budget_tokens).toBe(256);
    expect(fields.thinking_budget_tokens).toBeGreaterThan(0);
    expect(nPredict).toBe(1024);
  });

  test("null model: historical short 256, never budget 0", () => {
    const { fields } = resolveThinkingParams("default", null);
    expect(fields.enable_thinking).toBe(true);
    expect(fields.thinking_budget_tokens).toBe(256);
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
