/**
 * Pure decision for the tool-round n_ctx guard.
 *
 * AppShell guards the prompt it assembles, but every tool round appends a tool
 * call plus its results and calls completion() again. The ceiling must be
 * re-checked before each round after the first; when it fires, the loop stops
 * rather than hand the native a prompt it could only answer with ctx_shift
 * (irreparable on a hybrid attn+recurrent model).
 *
 * Extracted so a Node harness can exercise the shipped decision without
 * llama.rn — the same split as toolRoundFallback.ts: the condition lives here,
 * the I/O (break, telemetry, honest message) stays in LlamaService.ts.
 */

import { promptTokensExceedNCtx } from "../context/windowProfile";

/**
 * True when round N (N > 0) would send a prompt above `n_ctx - reserve`.
 * The first round is never stopped by this guard: AppShell already vetted the
 * prompt it assembled, and stopping round 0 would turn a cold send into an
 * empty turn.
 */
export function toolRoundCrossesCeiling(args: {
  round: number;
  nCtx: number | null | undefined;
  promptChars: number;
}): boolean {
  if (args.round <= 0) return false;
  return promptTokensExceedNCtx({
    nCtx: args.nCtx,
    promptChars: args.promptChars,
  });
}
