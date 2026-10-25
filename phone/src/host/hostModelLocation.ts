import type { ModelPipelineState } from "./hostPipelineState";
import type { TranslateFn } from "../i18n";
import { pillWhereLabel } from "./modelBar";

/** The strip location is a backend fact, except for the refusal claims. */
export function hostModelLocation(input: {
  remote: boolean;
  modelState: ModelPipelineState;
  modelError: string | null;
  t: TranslateFn;
}): { location: "phone" | "server"; label: string } {
  if (input.remote) {
    // The computer is the selected backend, but a failed remote init means
    // nothing answers there: "Your computer" would be a claim the model bar's
    // own error line contradicts. The monitor glyph stays — the selection has
    // not moved, only the claim about it.
    const label = input.modelState === "error"
      ? "shell.where.computerNotResponding"
      : "shell.where.pillComputer";
    return { location: "server", label: input.t(label) };
  }
  return { location: "phone", label: input.t(pillWhereLabel(input)) };
}
