/**
 * The composer's phase, derived from host state — the one piece between the
 * machine and `composerState.ts` (which decides hold/face/editable from it).
 *
 * Pure on purpose: the mapping is the whole question of what the composer
 * says while the machine moves, and this stack has no render harness to
 * assert it on. The engine's status callback names the live phase —
 * `thinkingStatus` until the first visible token, anything else after (the
 * same flip LlamaService owns for the old chip).
 */
import type { ModelPipelineState } from "./hostPipelineState";
import type { ComposerPhase } from "../ui/shell/composerState";

export interface ComposerPhaseInput {
  /** False only during the first milliseconds, before history settles. */
  historyLoaded: boolean;
  /** OS thermal CRITICAL: the machine refuses every entry point. */
  thermalGated: boolean;
  /** A run is live (the engine has not released). */
  sending: boolean;
  /** Abort issued for the live run, engine not yet released (§2.8 stopping). */
  stopping: boolean;
  /** Any token streamed in the live run (prefill vs. writing). */
  hasTokens: boolean;
  /** The live assistant's statusLabel, or undefined. */
  statusLabel?: string;
  /** `t("chat.thinkingStatus")`, captured already-translated. */
  thinkingStatus: string;
  modelState: ModelPipelineState;
  /** The engine holds this very model (isEngineReady + active match). */
  engineResident: boolean;
  /** A picked PDF is still being read into pages (the composer's own phase —
   *  the controller's `!pdfToRender` in `canSend`, `Chat:3620`, as a row of
   *  the table with its own hold line). */
  converting?: boolean;
}

export function hostComposerPhase(input: ComposerPhaseInput): ComposerPhase {
  if (input.thermalGated) return "tooHot";
  if (input.sending) {
    if (input.stopping) return "stopping";
    if (!input.hasTokens) return "prefill";
    return input.statusLabel === input.thinkingStatus ? "thinking" : "writing";
  }
  // A conversion is the composer's own wait: it outranks the model's pipeline
  // because it refuses THIS send (the rows are not ready), which is what the
  // hold line must say. It cannot coexist with `sending` — the attach control
  // is disabled while the face says stop, so no conversion starts mid-run.
  if (input.converting) return "converting";
  // Idle-side order: settle history first (the first renders of a switch are
  // not "ready"), then the model's own pipeline. "missing" and "error" are
  // both "not loaded" for the composer — the strip pill's tap is the way out.
  if (!input.historyLoaded) return "loading";
  if (input.modelState === "checking" || input.modelState === "loading") return "loading";
  if (input.modelState === "downloading") return "loading";
  if (input.modelState === "ready" && !input.engineResident) return "unloaded";
  if (input.modelState === "missing" || input.modelState === "error") return "unloaded";
  return "idle";
}
