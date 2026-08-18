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

function templateKwargs(
  model: ThinkingModel | null,
  enableThinking: boolean,
): ThinkingCompletionFields["chat_template_kwargs"] | undefined {
  if (model?.preserveThinking) {
    return { enable_thinking: enableThinking, preserve_thinking: true };
  }
  if (!enableThinking) {
    return { enable_thinking: false };
  }
  return undefined;
}

function withKwargs(
  fields: ThinkingCompletionFields,
  model: ThinkingModel | null,
  enableThinking: boolean,
): ThinkingCompletionFields {
  const kw = templateKwargs(model, enableThinking);
  return kw ? { ...fields, chat_template_kwargs: kw } : fields;
}

/**
 * Map bench thinking mode → NativeCompletionParams fields.
 *
 * Production ("default") is never thinking-off and never budget 0. The budget
 * is what we tune (`model.thinking.short`), not whether thinking exists.
 * Bench "off" remains reachable for A/B (budget 0 + enable_thinking: false).
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
    case "off":
      return {
        fields: withKwargs(
          {
            enable_thinking: false,
            thinking_budget_tokens: 0,
            reasoning_format: "none",
          },
          model,
          false,
        ),
        nPredict: 1024,
      };
    case "budget256":
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: model?.thinking?.short ?? 256,
          },
          model,
          true,
        ),
        nPredict,
      };
    case "budget512":
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: model?.thinking?.extended ?? 512,
          },
          model,
          true,
        ),
        nPredict,
      };
    case "default":
    default:
      return {
        fields: withKwargs(
          {
            enable_thinking: true,
            thinking_budget_tokens: model?.thinking?.short ?? 256,
            reasoning_format: "none",
          },
          model,
          true,
        ),
        nPredict,
      };
  }
}
