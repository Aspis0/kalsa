import type { ModelPipelineState } from "./hostPipelineState";
import type { TranslateFn } from "../i18n";
import { pillWhereLabel } from "./modelBar";

/** The strip location is a backend fact, except for the local refusal claim. */
export function hostModelLocation(input: {
  remote: boolean;
  modelState: ModelPipelineState;
  modelError: string | null;
  t: TranslateFn;
}): { location: "phone" | "server"; label: string } {
  return input.remote
    ? { location: "server", label: input.t("shell.where.pillComputer") }
    : {
        location: "phone",
        label: input.t(pillWhereLabel(input)),
      };
}
