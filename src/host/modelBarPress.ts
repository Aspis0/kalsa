/**
 * What a tap on the model pill does — the controller's chip semantics
 * (`AppShell.tsx:6874-6911`) as one decision: download if missing, retry if
 * error, load if ready-but-unloaded; disabled while the machine is busy
 * (checking/downloading/loading, or fully resident); INERT when the embedder
 * is hung — recovery there is a process restart, so every state including
 * missing answers nothing and the pill stops taking pointers entirely
 * (`pointerEvents="none"`, the controller's round-9 nit at `:6910`).
 *
 * Pure over inputs so the tap-state table is a test and not a device probe.
 */
import type { ModelPipelineState } from "./hostPipelineState";

export type ModelPressAction = "download" | "reload" | "none";
export type ModelPressDecision = {
  action: ModelPressAction;
  control: "enabled" | "disabled" | "inert";
};

export function decideModelPress(args: {
  modelState: ModelPipelineState;
  errorKind: "download" | "engine" | null;
  resident: boolean;
  hung: boolean;
}): ModelPressDecision {
  const { modelState, errorKind, resident, hung } = args;
  // Hung outranks everything, exactly as the controller's `disabled` list
  // does: no retry, no download, no reload can start behind a hung native op.
  if (hung) return { action: "none", control: "inert" };
  switch (modelState) {
    case "checking":
    case "downloading":
    case "loading":
      return { action: "none", control: "disabled" };
    case "missing":
      return { action: "download", control: "enabled" };
    case "error":
      // errorKind null counts as a download failure (controller `:6880-6885`).
      return errorKind === "engine"
        ? { action: "reload", control: "enabled" }
        : { action: "download", control: "enabled" };
    case "ready":
      // HIGH-2: downloaded-but-unloaded is tappable and never auto-loads;
      // fully resident is inert-but-visible (no dimming, as before).
      return resident
        ? { action: "none", control: "disabled" }
        : { action: "reload", control: "enabled" };
  }
}
