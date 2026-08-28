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
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: positiveBudget(model?.thinking?.short, 256),
            reasoning_format: "none",
          },
          model,
        ),
        nPredict,
      };
  }
}
