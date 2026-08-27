import type { ModelInfo } from "./ModelRegistry";
import type { ThinkingMode } from "../bench/benchConfig";

export type ThinkingCompletionFields = {
  enable_thinking?: boolean;
  thinking_budget_tokens?: number;
  reasoning_format?: "none" | "auto" | "deepseek";
  chat_template_kwargs?: { enable_thinking: boolean };
};

/**
 * Map bench thinking mode → NativeCompletionParams fields (enable_thinking / budget).
 * "default" keeps production options identical (thinking off + reasoning_format none).
 *
 * NO chat_template override (removed 2026-08-07, hostile-review-corrected).
 * What IS verified in the installed llama.rn 0.12.8 (chain traced file:line by
 * review of 464c349): stock template + enable_thinking:false closes the
 * prefill (both Qwen3.5 polarities), the autoparser detects the think tags
 * (compare_reasoning_presence — flag-independent — plus the conditional
 * generation branch), jinjaResult carries thinking_end_tag, and JSIParams arms
 * the reasoning-budget sampler with budget 0: a model-initiated <think> reopen
 * is force-closed within a token.
 *
 * What the override actually cost (and this removal buys): a full
 * common_chat_templates_init PER COMPLETION (rn-llama.cpp:629, marked
 * "probably slow" upstream). NOTE the earlier belief that the override
 * disarmed the budget belt was REFUTED by review: compare_reasoning_presence
 * detected tags from the override's history branch too, and the off prefill
 * was byte-identical before/after. The field observation that off ≈ budget256
 * wall time is real but its cause is UNPROVEN — candidates: longer un-reasoned
 * answers, runtime flag-delivery failure (needs device trace), per-completion
 * template re-init. Adjudication: perf telemetry (tokens_predicted off vs
 * budget on identical prompts).
 *
 * Per-model budgets: when model.thinking is set, budget256 uses short and
 * budget512 uses extended; nPredict is Math.max(1024, model.thinking.nPredict ?? 1024)
 * so a larger think block + answer still fit under the prediction ceiling.
 * Absent model.thinking → 256 / 512 / 1024 (historical defaults).
 */
export function resolveThinkingParams(
  mode: ThinkingMode,
  model: Pick<ModelInfo, "thinking"> | null,
): { fields: ThinkingCompletionFields; nPredict: number } {
  switch (mode) {
    case "off":
      return {
        fields: {
          enable_thinking: false,
          // Second belt — now ACTUALLY armed (see doc above): budget 0 means the
          // sampler forces the end tag the moment a think block opens.
          thinking_budget_tokens: 0,
          // Keep "none": app owns THINK_OPEN/THINK_CLOSE stream stripping; do not
          // switch to "auto" (changes stream shape the UI expects).
          reasoning_format: "none",
          chat_template_kwargs: { enable_thinking: false },
        },
        nPredict: 1024,
      };
    case "budget256":
      return {
        fields: {
          enable_thinking: true,
          thinking_budget_tokens: model?.thinking?.short ?? 256,
        },
        nPredict: Math.max(1024, model?.thinking?.nPredict ?? 1024),
      };
    case "budget512":
      return {
        fields: {
          enable_thinking: true,
          thinking_budget_tokens: model?.thinking?.extended ?? 512,
        },
        nPredict: Math.max(1024, model?.thinking?.nPredict ?? 1024),
      };
    case "default":
    default:
      // Production path — same belts as "off" (kwargs + armed budget 0).
      return {
        fields: {
          enable_thinking: false,
          thinking_budget_tokens: 0,
          reasoning_format: "none",
          chat_template_kwargs: { enable_thinking: false },
        },
        nPredict: 1024,
      };
  }
}
