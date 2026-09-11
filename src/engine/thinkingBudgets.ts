import type { ModelInfo } from "./ModelRegistry";
import type { ThinkingMode } from "../bench/benchConfig";

export type ThinkingCompletionFields = {
  enable_thinking?: boolean;
  thinking_budget_tokens?: number;
  reasoning_format?: "none" | "auto" | "deepseek";
  chat_template_kwargs?: {
    enable_thinking?: boolean;
    preserve_thinking?: boolean;
  };
};

type ThinkingModel = Pick<ModelInfo, "thinking" | "preserveThinking">;

/**
 * Five tok/s selects extended thinking: Jelly LFM is about 3.4 tok/s, while
 * Galaxy S23 is about 10–11 tok/s and Xiaomi is faster. Runtime speed keeps
 * one kernel path for all phones.
 */
export const EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC = 5;

function positiveBudget(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function templateKwargs(
  model: ThinkingModel | null,
): ThinkingCompletionFields["chat_template_kwargs"] | undefined {
  if (model?.preserveThinking) {
    return { enable_thinking: true, preserve_thinking: true };
  }
  return undefined;
}

function withKwargs(
  fields: ThinkingCompletionFields,
  model: ThinkingModel | null,
): ThinkingCompletionFields {
  const kw = templateKwargs(model);
  return kw ? { ...fields, chat_template_kwargs: kw } : fields;
}

/**
 * Calc/tool-shaped user turns: Jelly at 1024 thinking burned the budget
 * then Interrompi with toolChoice:auto and zero tool_calls. Short budget
 * so the model can still emit a call.
 *
 * + × * ÷ always. Minus and slash only with spaces ("18 - 7"), never dates
 * ("2026-09-11", "12/25/2026"). Bare "x" is not multiply ("3x2").
 */
export function userTurnLooksLikeToolRequest(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\d+\s*[+×*÷]\s*\d/.test(t)) return true;
  if (/\d+\s+[-/]\s+\d/.test(t)) return true;
  if (/\d+\s*più\s*\d/.test(t)) return true;
  if (
    /\b(calcolatrice|calcolare|calcola|quanto fa|calculator|calculate|somma|moltiplica|dividi)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Speed opts LlamaService passes into resolveThinkingParams. */
export function thinkingSpeedOpts(
  decodeTokPerSec: number | null,
  lastUserMessage: unknown,
): { decodeTokPerSec: number | null; forceShort: boolean } {
  return {
    decodeTokPerSec,
    forceShort: userTurnLooksLikeToolRequest(lastUserMessage),
  };
}

/**
 * Map bench thinking mode → NativeCompletionParams fields.
 *
 * Every accepted mode keeps thinking enabled with a positive budget. The
 * budget is what we tune (`model.thinking.short`), not whether thinking exists.
 * A stale runtime value outside the type falls through to the production
 * default for the same reason: old storage must not disable reasoning.
 *
 * `preserve_thinking` is emitted only when the model declares
 * `preserveThinking` (template strips history `<think>` otherwise, and
 * non-Qwen arches cannot roll the KV back — see HARNESS_FINDINGS §7.8).
 */
export function resolveThinkingParams(
  mode: ThinkingMode,
  model: ThinkingModel | null,
  speed?: { decodeTokPerSec: number | null; forceShort?: boolean },
): { fields: ThinkingCompletionFields; nPredict: number } {
  const nPredict = Math.max(1024, model?.thinking?.nPredict ?? 1024);
  switch (mode) {
    case "budget256":
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: positiveBudget(model?.thinking?.short, 256),
          },
          model,
        ),
        nPredict,
      };
    case "budget512":
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: positiveBudget(model?.thinking?.extended, 512),
          },
          model,
        ),
        nPredict,
      };
    case "default":
    default:
      {
        const extended =
          !speed?.forceShort &&
          speed?.decodeTokPerSec !== null &&
          speed?.decodeTokPerSec !== undefined &&
          speed.decodeTokPerSec >= EXTENDED_THINKING_MIN_DECODE_TOK_PER_SEC;
        const budget = extended
          ? positiveBudget(model?.thinking?.extended, 512)
          : positiveBudget(model?.thinking?.short, 256);
        return {
          fields: withKwargs(
            {
              enable_thinking: true,
              thinking_budget_tokens: budget,
              reasoning_format: "none",
            },
            model,
          ),
          nPredict,
        };
      }
  }
}
